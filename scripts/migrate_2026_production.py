#!/usr/bin/env python3
"""Generate SQL to import the "2026 Production" sheet into public.orders.

Usage:
    python3 migrate_2026_production.py <path-to-workbook.xlsx> [--year 2026] \
        [--out ../supabase/migration_data/2026_production_import.sql]

This writes a .sql file of INSERT statements -- it does NOT touch any
database itself. Review the generated file (especially the "needs review"
rows it prints to stderr) before running it against Supabase's SQL Editor.

NetSuite reconciliation: this script leaves `netsuite_so_id` NULL on every
imported row -- the spreadsheet's "S/O #" column maps to `so_number`, not
necessarily NetSuite's internal transaction id, and we don't have a live
NetSuite connection to confirm which. `netsuite-sync`'s upsert logic
specifically looks for an existing row with a matching `so_number` and a
NULL `netsuite_so_id` and links it instead of inserting a duplicate -- see
supabase/functions/netsuite-sync/index.ts's `upsertOrders`. That's what
makes it safe to run this import before NetSuite sync is live.

Only "2026 Production" is handled here. The 2024 and 2025 sheets use
different column layouts (see README "Known gaps") and need a mapping
decision before they can be scripted the same way.
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

import openpyxl

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10,
    "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}

SHEET_NAME = "2026 Production"
HEADER_ROW = 12
DATA_START_ROW = 13

# Column letters as they stand in the real workbook's header row 12,
# confirmed against the uploaded file (not a generic Simple-View guess).
COLUMNS = {
    "order_date": "A", "so_number": "B", "revenue": "C", "school": "D",
    "labs_qty": "E", "ts_qty": "F", "doe_po": "G", "device_po": "H",
    "pcs_received": "I", "pc_serial_number": "K", "ship_date": "L",
    "billing_status_raw": "M", "bill_month_raw": "N", "status_raw": "O",
    "elevator_steps": "P", "install_date": "Q", "sn_tag": "R",
    "on_order_notes": "S", "notes": "T", "install_status_raw": "U",
    "room_number": "V", "teacher": "W", "phone": "X", "email": "Y",
    "comments": "Z",
}


def sql_quote(value) -> str:
    if value is None or value == "":
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dt.date, dt.datetime)):
        return f"'{value.date().isoformat() if isinstance(value, dt.datetime) else value.isoformat()}'"
    text = str(value).strip().replace("'", "''")
    return f"'{text}'"


def normalize_billing_status(raw: str | None) -> str:
    if not raw:
        return "not_submitted"
    t = raw.strip().lower()
    if "paid" in t:
        return "paid"
    if "on hold" in t or "onhold" in t:
        return "on_hold"
    if "fulfilled" in t:
        return "fulfilled"
    if "submitted" in t or "invoiced" in t:
        return "submitted"
    return "not_submitted"


def normalize_bill_month(raw, year: int) -> tuple[str | None, bool]:
    """Returns (ISO date string or None, whether the raw text was a clean
    match -- i.e. whether it's safe to NOT keep it in legacy_status_text)."""
    if raw is None:
        return None, True
    if isinstance(raw, (dt.date, dt.datetime)):
        d = raw.date() if isinstance(raw, dt.datetime) else raw
        return d.replace(day=1).isoformat(), True

    text = str(raw).strip()
    # "Jan 2027" style -- month plus an explicit year.
    m = re.match(r"^([A-Za-z]+)\s+(\d{4})$", text)
    if m and m.group(1).lower() in MONTHS:
        month = MONTHS[m.group(1).lower()]
        return dt.date(int(m.group(2)), month, 1).isoformat(), True

    key = text.lower()
    if key in MONTHS:
        return dt.date(year, MONTHS[key], 1).isoformat(), True

    # Anything else ("At Risk", blank, etc.) isn't a real month -- leave
    # bill_month NULL and flag it so the raw text lands in legacy_status_text.
    return None, False


def normalize_install_status(raw: str | None) -> str:
    if raw and "install" in raw.strip().lower():
        return "installed"
    return "not_installed"


def as_date_or_none(value, field_name: str, legacy_bits: list[str]) -> dt.date | None:
    """`pcs_received`/`ship_date`/`install_date`/`order_date` are typed
    `date` in the schema, but the real sheet sometimes has free text in them
    instead (e.g. "Pending MACs" in a PCS Rec cell) -- a plain Postgres cast
    would reject that at insert time. Divert anything that isn't an actual
    date into legacy_status_text and leave the column NULL."""
    if value is None or value == "":
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    legacy_bits.append(f"{field_name}={value}")
    return None


def as_number_or(value, field_name: str, legacy_bits: list[str], default=None):
    """`revenue`/`labs_qty`/`ts_qty` are numeric-typed columns, but the real
    sheet sometimes has stray text in them (e.g. a bare "A" where a quantity
    should be). Divert anything that doesn't parse as a number into
    legacy_status_text and fall back to `default` (0 for the not-null qty
    columns, None for nullable revenue) instead of generating an invalid
    numeric literal."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        legacy_bits.append(f"{field_name}={value}")
        return default
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip()
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        legacy_bits.append(f"{field_name}={value}")
        return default


def derive_order_status(install_date, ship_date, device_po) -> str:
    # Derived from dates already on the row rather than parsed from the
    # free-text Status column, which mixes billing and install language
    # inconsistently in the source sheet.
    if install_date:
        return "delivered_installed"
    if ship_date:
        return "shipped"
    if device_po:
        return "device_ordered"
    return "new"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "supabase" / "migration_data" / "2026_production_import.sql",
    )
    args = parser.parse_args()

    wb = openpyxl.load_workbook(args.workbook, data_only=True)
    ws = wb[SHEET_NAME]

    rows_sql: list[str] = []
    needs_review: list[str] = []
    skipped = 0

    for r in range(DATA_START_ROW, ws.max_row + 1):
        def cell(key: str):
            return ws[f"{COLUMNS[key]}{r}"].value

        school = cell("school")
        if not school or not str(school).strip():
            continue

        so_number = cell("so_number")
        billing_status = normalize_billing_status(cell("billing_status_raw"))
        bill_month, bill_month_clean = normalize_bill_month(cell("bill_month_raw"), args.year)
        install_status = normalize_install_status(cell("install_status_raw"))
        ship_date = cell("ship_date")
        install_date = cell("install_date")
        device_po = cell("device_po")
        status = derive_order_status(install_date, ship_date, device_po)

        legacy_bits = []
        raw_status_text = cell("status_raw")
        raw_billing_text = cell("billing_status_raw")
        if raw_status_text:
            legacy_bits.append(f"status={raw_status_text}")
        if raw_billing_text and normalize_billing_status(raw_billing_text) == "not_submitted" and str(raw_billing_text).strip().lower() not in ("", "not submitted"):
            legacy_bits.append(f"billing_status={raw_billing_text}")
        if not bill_month_clean and cell("bill_month_raw"):
            legacy_bits.append(f"bill_month={cell('bill_month_raw')}")

        # Date-typed columns: only let through real date/datetime values --
        # free text (e.g. "Pending MACs") goes to legacy_bits instead of
        # becoming an invalid date literal in the generated SQL.
        order_date_clean = as_date_or_none(cell("order_date"), "order_date", legacy_bits)
        pcs_received_clean = as_date_or_none(cell("pcs_received"), "pcs_received", legacy_bits)
        ship_date_clean = as_date_or_none(ship_date, "ship_date", legacy_bits)
        install_date_clean = as_date_or_none(install_date, "install_date", legacy_bits)

        # Numeric-typed columns: same problem, same fix -- a stray "A" or
        # similar in a quantity/revenue cell must not become an invalid
        # numeric literal in the generated SQL.
        revenue_clean = as_number_or(cell("revenue"), "revenue", legacy_bits, default=None)
        labs_qty_clean = as_number_or(cell("labs_qty"), "labs_qty", legacy_bits, default=0)
        ts_qty_clean = as_number_or(cell("ts_qty"), "ts_qty", legacy_bits, default=0)

        legacy_status_text = " | ".join(legacy_bits) if legacy_bits else None

        if not bill_month_clean:
            needs_review.append(f"row {r} ({school}): bill_month raw value {cell('bill_month_raw')!r} not recognized, left NULL")

        notes_parts = [p for p in [cell("notes"), cell("comments")] if p]
        notes = " / ".join(str(p) for p in notes_parts) if notes_parts else None

        values = {
            "so_number": str(so_number) if so_number is not None else None,
            "order_date": order_date_clean,
            "school": school,
            "revenue": revenue_clean,
            "labs_qty": labs_qty_clean,
            "ts_qty": ts_qty_clean,
            "doe_po": cell("doe_po"),
            "device_po": device_po,
            "pcs_received": pcs_received_clean,
            "pc_serial_number": cell("pc_serial_number"),
            "ship_date": ship_date_clean,
            "install_date": install_date_clean,
            "install_status": install_status,
            "elevator_steps": cell("elevator_steps"),
            "sn_tag": cell("sn_tag"),
            "on_order_notes": cell("on_order_notes"),
            "room_number": cell("room_number"),
            "teacher": cell("teacher"),
            "phone": cell("phone"),
            "email": cell("email"),
            "status": status,
            "billing_status": billing_status,
            "bill_month": bill_month,
            "notes": notes,
            "legacy_status_text": legacy_status_text,
            "production_year": args.year,
        }

        cols = ", ".join(values.keys())
        vals = ", ".join(sql_quote(v) for v in values.values())
        # so_number is intentionally not unique (see schema comment -- a few
        # real SOs are split across more than one tracked row), so there's no
        # ON CONFLICT target to dedupe against. This script is meant to run
        # once against an empty/freshly-migrated table; re-running it without
        # clearing public.orders first will duplicate rows.
        rows_sql.append(f"insert into public.orders ({cols}) values ({vals});")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    header = (
        f"-- Generated by scripts/migrate_2026_production.py from {args.workbook.name}\n"
        f"-- {len(rows_sql)} orders, production_year={args.year}. Review before running.\n"
        f"-- netsuite_so_id is left NULL; see the module docstring for why that's safe.\n\n"
    )
    args.out.write_text(header + "\n".join(rows_sql) + "\n")

    print(f"Wrote {len(rows_sql)} rows to {args.out}", file=sys.stderr)
    if skipped:
        print(f"Skipped {skipped} blank rows", file=sys.stderr)
    if needs_review:
        print(f"\n{len(needs_review)} rows need a look:", file=sys.stderr)
        for line in needs_review:
            print(f"  - {line}", file=sys.stderr)


if __name__ == "__main__":
    main()
