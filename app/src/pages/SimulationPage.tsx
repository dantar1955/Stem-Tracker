import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { formatCurrency } from '../lib/format'
import type { Order, ShipDecision, SimulationItem, SimulationScenario } from '../types/database'

export function SimulationPage() {
  const { role, user } = useAuth()
  const canWrite = role === 'sales' || role === 'admin'

  const [scenarios, setScenarios] = useState<SimulationScenario[]>([])
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null)
  const [items, setItems] = useState<SimulationItem[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function loadScenarios() {
    const { data, error } = await supabase.from('simulation_scenarios').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message)
    else {
      setScenarios((data as SimulationScenario[]) ?? [])
      if (data && data.length > 0 && !activeScenarioId) setActiveScenarioId(data[0].id)
    }
  }

  async function loadItems(scenarioId: string) {
    const { data, error } = await supabase.from('simulation_items').select('*').eq('scenario_id', scenarioId)
    if (error) setError(error.message)
    else setItems((data as SimulationItem[]) ?? [])
  }

  useEffect(() => {
    loadScenarios()
    supabase
      .from('orders')
      .select('*')
      .then(({ data }) => setOrders((data as Order[]) ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (activeScenarioId) loadItems(activeScenarioId)
  }, [activeScenarioId])

  async function createScenario() {
    if (!newName.trim()) return
    const { data, error } = await supabase
      .from('simulation_scenarios')
      .insert({ name: newName.trim(), created_by: user?.id })
      .select()
      .single()
    if (error) setError(error.message)
    else {
      setNewName('')
      await loadScenarios()
      setActiveScenarioId(data.id)
    }
  }

  async function addOrderToScenario(orderId: string) {
    if (!activeScenarioId) return
    const { error } = await supabase
      .from('simulation_items')
      .insert({ scenario_id: activeScenarioId, order_id: orderId, ship_decision: 'ship' })
    if (error) setError(error.message)
    else loadItems(activeScenarioId)
  }

  async function setDecision(itemId: string, decision: ShipDecision) {
    const { error } = await supabase.from('simulation_items').update({ ship_decision: decision }).eq('id', itemId)
    if (error) setError(error.message)
    else activeScenarioId && loadItems(activeScenarioId)
  }

  const ordersById = new Map(orders.map((o) => [o.id, o]))
  const itemsWithOrders = items.filter((i) => i.order_id)
  const simulatedRevenue = itemsWithOrders.reduce((sum, i) => {
    if (i.ship_decision === 'not_ship') return sum
    const o = ordersById.get(i.order_id!)
    return sum + (i.revenue_override ?? o?.revenue ?? 0)
  }, 0)
  const excludedRevenue = itemsWithOrders.reduce((sum, i) => {
    if (i.ship_decision !== 'not_ship') return sum
    const o = ordersById.get(i.order_id!)
    return sum + (o?.revenue ?? 0)
  }, 0)

  const ordersNotInScenario = orders.filter((o) => !items.some((i) => i.order_id === o.id))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Simulation</h2>
        <select
          value={activeScenarioId ?? ''}
          onChange={(e) => setActiveScenarioId(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({new Date(s.created_at).toLocaleDateString()})
            </option>
          ))}
        </select>
        {canWrite && (
          <>
            <input
              placeholder="New scenario name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <button onClick={createScenario} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">
              Save as new scenario
            </button>
          </>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {activeScenarioId && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium uppercase text-slate-500">Simulated revenue</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCurrency(simulatedRevenue)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium uppercase text-slate-500">Excluded (not ship)</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{formatCurrency(excludedRevenue)}</p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">School</th>
                  <th className="px-3 py-2 text-left">Revenue</th>
                  <th className="px-3 py-2 text-left">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itemsWithOrders.map((item) => {
                  const o = ordersById.get(item.order_id!)
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-2">{o?.school ?? '—'}</td>
                      <td className="px-3 py-2">{formatCurrency(item.revenue_override ?? o?.revenue)}</td>
                      <td className="px-3 py-2">
                        {canWrite ? (
                          <select
                            value={item.ship_decision ?? 'ship'}
                            onChange={(e) => setDecision(item.id, e.target.value as ShipDecision)}
                            className="rounded-md border border-slate-300 px-2 py-0.5 text-xs"
                          >
                            <option value="ship">Ship</option>
                            <option value="not_ship">Not ship</option>
                          </select>
                        ) : (
                          item.ship_decision
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {canWrite && ordersNotInScenario.length > 0 && (
            <div className="mt-4">
              <label className="text-sm text-slate-600">
                Add a school to this scenario:{' '}
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) addOrderToScenario(e.target.value)
                    e.target.value = ''
                  }}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {ordersNotInScenario.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.school}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </>
      )}

      {scenarios.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">No scenarios yet — create one above to start modeling.</p>
      )}
    </div>
  )
}
