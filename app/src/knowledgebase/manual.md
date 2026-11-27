# Instruction manual

The STEM Production Tracker replaces the STEM STATUS spreadsheet. It keeps every sales order, build, shortage, device shipment and pipeline opportunity in one place, pulls order details from NetSuite automatically, and records every change.

**Contents:** 1. Signing in · 2. Roles · 3. Dashboard · 4. Orders · 5. Pipeline · 6. Build Tracker · 7. Shortages · 8. Device Shipping · 9. Simulation · 10. Reporting · 11. NetSuite sync · 12. Knowledgebase · 13. Admin · 14. Troubleshooting · 15. Glossary

---

## 1. Signing in

- Sign in with your work email and password. There's no self sign-up: an administrator creates every account.
- **First sign-in:** your administrator gives you a temporary password. Right after signing in you'll be asked to choose your own (at least 8 characters, typed twice). You can't use the rest of the app until you do.
- **Forgotten password:** ask an administrator to reset it. You'll get a new temporary password and choose your own again.
- **Suspended account:** if you see "Your access has been suspended", contact an administrator.
- **Signing out:** click **Sign out** at the top right. Sign-ins and sign-outs are recorded in the audit trail.

## 2. Roles

Everyone can see every page except **Admin**. What you can *change* depends on your role:

| Area | Sales | Operations | Accounting | Admin |
|---|---|---|---|---|
| Order: school, revenue | ✓ | | | ✓ |
| Order: device PO, PCS received, PC serial #, ship date, install date, install status, status, room #, teacher, phone, email, elevator/steps, on order, at risk | | ✓ | | ✓ |
| Order: billing status, bill month | | | ✓ | ✓ |
| Order: notes | ✓ | ✓ | ✓ | ✓ |
| Pipeline, goals, weekly snapshot | ✓ | | | ✓ |
| Simulation | ✓ | | | ✓ |
| Build Tracker, Shortages, Device Shipping | | ✓ | | ✓ |
| Admin tab (users, audit trail, backup) | | | | ✓ |

Fields you can't change appear greyed out. The database enforces these rules too, so they can't be bypassed.

## 3. Dashboard

The dashboard shows the current year. By default it counts **production orders**: orders with labs or teacher stations, plus every order carried over from the spreadsheet. Tick **Include all orders** to add non-lab orders such as SnappyXO.

### Colour key

Every colour means one thing, and the key is shown at the top of the dashboard:

| Colour | Meaning |
|---|---|
| Green | Done / money in |
| Blue | In progress, on track |
| Amber | Needs action |
| Red | At risk |
| Purple | Forecast, not yet on a PO |
| Grey | For information / nothing to do |

Amber and red cards turn grey when their value is zero.

### ① Projections

- **Committed:** shipped + on a PO but not shipped yet (at-risk orders excluded).
- **Pipeline:** total of Pipeline-stage opportunities on the Pipeline tab, with the change since last week's snapshot.
- **Awaiting PO:** total of Awaiting PO opportunities, with the change since last week.
- **Total projected:** Committed + Pipeline + Awaiting PO.
- **Goal bar:** progress against the year's revenue goal. Green is shipped so far, purple is everything projected, and the black line marks the in-our-control target. Goals are set on the Pipeline tab.

### ② Where we are

These use the same definitions as the old spreadsheet dashboard:

- **Shipped YTD:** orders whose ship date is today or earlier.
- **Billed:** billing status Submitted, Submitted – on hold, Fulfilled or Paid.
- **Paid:** billing status Fulfilled or Paid. The card also shows the amount awaiting payment (Submitted / on hold).
- **Shipped, not billed:** shipped orders that aren't billed yet. Invoice these.
- **Collected:** Paid ÷ Shipped.

### ③ On a PO but not shipped yet

- **Scheduled to ship:** unshipped orders that have a bill month.
- **Not yet scheduled:** unshipped orders with no bill month. Give these a bill month.
- **At risk:** orders flagged at risk. They're left out of every other total, as on the spreadsheet.

### ④ Delivering without devices

- **Shipped, devices not received:** shipped orders whose PCS Received is still empty.
- **Total orders** and the date of the **last weekly snapshot**.

## 4. Orders

### Finding orders

- Choose the **year** at the top. Orders belong to the production year they're billed in; the January queue is in next year.
- **Search** by school or S/O number, then press Enter or click **Search**.
- **Show all orders** adds non-lab orders, tagged **Non-lab**. Orders flagged at risk are tagged **At risk**.

### Row colours

| Colour | Meaning |
|---|---|
| Green | Shipped (ship date today or earlier) |
| Blue | Shipped, but devices outstanding (PCS Received empty) |
| Yellow | Scheduled or in build (future ship date, or a build S/N assigned) |
| White | Not yet scheduled |
| Grey | Next year's queue |
| Pink | No sales order number yet |

### Editing an order

Click a row to open it. The panel has four parts:

1. **From NetSuite:** revenue, school, labs, teacher stations, DOE P.O. These update from NetSuite automatically (see section 11).
2. **Operations:** device PO, PCS received, serial #, ship and install dates, statuses, contact details, and the **At risk** box.
3. **Accounting:** billing status and bill month.
4. **Notes:** shared by everyone.

Click **Save changes**. Only the fields you changed are saved, and each change is recorded in the audit trail with its old and new value.

**Billing status, in order:** Not submitted → Submitted to DOE portal → Submitted – on hold → Fulfilled → Paid.

## 5. Pipeline

The Pipeline tab replaces the Awaiting PO list and the weekly pipeline numbers that used to be typed into the sheet. Sales and Admin can edit it; everyone else can view it.

### Stages

| Stage | Meaning | Counts on dashboard |
|---|---|---|
| Pipeline | Early opportunity | Yes (Pipeline) |
| Awaiting PO | Verbal yes, waiting on the PO | Yes (Awaiting PO) |
| PO received | Won. The order will come in from NetSuite | No |
| Lost | No longer expected | No |

When a PO arrives, set the opportunity to **PO received** so it isn't counted twice once the NetSuite order appears.

### Adding and editing

- **+ Add opportunity:** fill in the school/opportunity, stage, likelihood (Most likely / Possible), labs, teacher stations, estimated revenue, expected PO date, year, owner and notes.
- **Edit / Delete:** use the links at the end of each row.
- The filter chips show open opportunities (Pipeline + Awaiting PO) by default.

### Goals

Enter the year's **Revenue goal** and **In-our-control target**, then click **Save goals**. The dashboard's goal bar uses them.

### Excel template

- **Download blank template:** an Excel file with the right columns, drop-down lists for Stage and Likelihood, and a "How to use" tab.
- **Export to Excel:** the same template filled with the current year's opportunities. Each row has an ID column, so you can edit the file and upload it again to update those entries.
- **Upload template:** choose a filled-in file. A preview shows how many rows will be added, how many updated, and any rows with problems (these are skipped and listed with the reason). Click **Import** to apply.
  - Tick **Remove entries that aren't in this file** only if the file is your complete list for that year.
  - Don't change the ID column. Leave it blank for new rows.

### Weekly snapshots

Every Monday morning the system saves the Pipeline and Awaiting PO totals automatically. The dashboard compares against last week's snapshot ("▲ $50,000 vs last week"). **Save this week's totals** saves or refreshes this week's snapshot on demand.

## 6. Build Tracker

One row per lab or teacher-station build: school, serial/build ID, builder, status (In progress / Complete), start and end dates, and whether devices have been received. Operations and Admin can add and update builds. Teacher-station builds are recognised by "MTS" in the build ID.

## 7. Shortages

Items short on an order: S/O #, customer, item, quantity, PO # and date, and the vendor's estimated ship date. Tick **Resolved** when the item arrives. Operations and Admin can edit.

## 8. Device Shipping

Device purchase orders: device PO, school, devices, carrier, tracking numbers, ship date and received date. Operations and Admin can edit.

## 9. Simulation

"What if" scenarios: choose Ship or Not ship for each order and add possible new POs (Most likely / Possible) to see the simulated revenue. Sales and Admin can create scenarios. Simulations never change real orders.

## 10. Reporting

Revenue by bill month across all years: shipped, billed, paid and total. Read-only.

## 11. NetSuite sync

- Every **10 minutes**, the system reads sales orders changed in NetSuite in the last 20 minutes.
- From NetSuite: S/O number, order date, customer (school), total (revenue), DOE PO (the PO # field), and lab and teacher-station counts.
  - **Labs** = quantities of AMSL-ILC-*, AMSL-ELEM, AMSL-STEM and AMSL-FAB-* items.
  - **Teacher stations** = quantities of A+ Mobile Teachers Station items.
- **Every** NetSuite sales order is brought in. Ones without labs or teacher stations are "non-lab" and hidden by default.
- New NetSuite orders are added automatically; existing ones are updated. The sync never touches what your team enters (dates, statuses, billing, notes).
- To correct a NetSuite value, change it in NetSuite. The tracker picks it up within 10 minutes.
- Sync changes appear in the audit trail as **NetSuite sync**.

## 12. Knowledgebase

This section: the **Quickstart guide**, this **Instruction manual**, and the **Explainer video**. Use **Print / save as PDF** to keep a copy.

## 13. Admin (administrators only)

The **Admin** tab appears only for administrators.

### Users

- **+ Add user:** name, email, role and a temporary password (click **Generate** for a strong one). After saving, the sign-in details are shown once. Copy them and share them privately. The user must choose their own password at first sign-in.
- **Edit:** change name, email or role.
- **Reset password:** set a new temporary password. The user chooses their own at next sign-in.
- **Suspend:** the user can no longer change anything, is signed out, and can't sign in. **Restore access** reverses it.
- You can't suspend yourself, and the system won't let you suspend or demote the last active admin.
- Status shows **Active**, **Temp password** (hasn't chosen their own yet) or **Suspended**.

### Audit trail

A permanent record of everything done in the system:

- Every add, change and delete, with the old and new value of each field changed.
- Sign-ins, sign-outs and password changes.
- User management (created, edited, password reset, suspended, restored).
- Backups, pipeline imports and exports.
- Changes by the **NetSuite sync**, and any made directly in the database (**System / SQL Editor**).

Filter by user, area, type, date range or record (for example "SO144592" or "160K"), click **Load more** for older entries, and **Export to Excel** for the filtered list. Entries can't be edited or deleted by anyone.

### Backup

**Back up everything now** downloads two files:

- **Excel (.xlsx):** one tab per table, easy to read.
- **JSON (.json):** an exact copy, the one to keep for restoring.

They include every order, build, shortage, device shipment, pipeline entry, goal, snapshot, simulation, the user list (no passwords) and the full audit trail. Your browser may ask permission to download two files. Store backups somewhere restricted, as they contain all customer data.

## 14. Troubleshooting

| Problem | What to do |
|---|---|
| A field is greyed out | Your role can't change it (see section 2), or it comes from NetSuite. |
| An order is missing | Tick **Show all orders**, check the year, and search by S/O number. New NetSuite orders appear within 10 minutes. |
| A NetSuite value is wrong | Fix it in NetSuite; the tracker updates within 10 minutes. |
| Upload skipped some rows | The preview lists each row and the reason. Fix those rows in Excel and upload again. |
| "Your access has been suspended" | Contact an administrator. |
| Dates look a day off | Refresh the page. Dates are shown in your computer's time zone. |
| Something changed unexpectedly | An admin can look it up in **Admin → Audit trail**. |

## 15. Glossary

- **S/O:** NetSuite sales order number (e.g. SO144592).
- **DOE PO:** the Department of Education's purchase order number (NetSuite's PO # field).
- **Lab / TS:** a mobile STEM lab / a mobile teacher station.
- **PCS Rec:** date the PCs (devices) were received for the order.
- **Bill month:** the month the order is planned to be billed.
- **Production year:** the year an order's revenue counts toward.
- **At risk:** an order that may not ship this year; excluded from the totals.
- **Committed:** shipped + on a PO but not yet shipped.
- **Pipeline / Awaiting PO:** opportunities not yet on a PO.
