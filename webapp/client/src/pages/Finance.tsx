/**
 * Finance.tsx — R5 accountant page: per-farm financial ledger.
 * ---------------------------------------------------------------------------
 * • Farm selector scopes everything to one farm (or "All farms").
 * • KPI cards: total expense / income / net.
 * • Filterable ledger table + "Add entry" form.
 * Owner-only (server enforces role).
 */

import React, { useEffect, useState } from 'react';
import { api } from '../api';

/** Farm row from GET /farms. */
interface Farm {
  id: string;
  name: string;
}
/** Ledger row from GET /finances. */
interface Entry {
  id: string;
  farmId: string;
  type: 'expense' | 'income';
  category: string;
  amount: number;
  currency: string;
  note?: string;
  createdAt: number;
}

export default function Finance() {
  const [farms, setFarms] = useState<Farm[]>([]);
  const [farmId, setFarmId] = useState(''); // '' = all farms
  const [entries, setEntries] = useState<Entry[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState('');

  // New-entry form state
  const [form, setForm] = useState({ type: 'expense', category: 'seeds', amount: '', note: '', farmId: 'farm-1' });

  /** Reload ledger + KPIs whenever the farm scope changes. */
  async function load() {
    try {
      const q = farmId ? `&farmId=${farmId}` : '';
      void q;
      const [e, s] = await Promise.all([
        api.finances(farmId),
        api.financeSummary(farmId),
      ]);
      setEntries(e as Entry[]);
      setSummary(s);
    } catch (err: any) {
      setError(err.message);
    }
  }
  useEffect(() => {
    api.farms().then(setFarms).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId]);

  /** Submit the new-entry form. */
  async function addEntry() {
    try {
      await api.addFinance({
        ...form,
        amount: Number(form.amount),
        farmId: form.farmId || farmId || farms[0]?.id,
      });
      setForm({ ...form, amount: '', note: '' });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>💰 Finance</h1>

      {/* Farm scope selector — the accountant reviews per farm */}
      <div className="chips">
        <button
          className={farmId === '' ? 'chip active' : 'chip'}
          onClick={() => setFarmId('')}
        >
          All farms
        </button>
        {farms.map((f) => (
          <button
            key={f.id}
            className={farmId === f.id ? 'chip active' : 'chip'}
            onClick={() => setFarmId(f.id)}
          >
            {f.name}
          </button>
        ))}
      </div>

      {/* KPI cards from /finances/summary */}
      {summary && (
        <div className="kpis">
          <div className="kpi red">
            <b>{(summary.totalExpense ?? 0).toLocaleString()}</b> expenses
          </div>
          <div className="kpi green">
            <b>{(summary.totalIncome ?? 0).toLocaleString()}</b> income
          </div>
          <div className="kpi orange">
            <b>{(summary.net ?? 0).toLocaleString()}</b> net
          </div>
        </div>
      )}

      {/* Quick add-entry form */}
      <div className="row">
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {['seeds', 'fertilizer', 'labor', 'fuel', 'equipment', 'harvest_sale', 'other'].map((c) => (
            <option key={c} value={c}>{c.replace('_', ' ')}</option>
          ))}
        </select>
        <input
          placeholder="Amount"
          type="number"
          style={{ width: 110 }}
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
        <input
          placeholder="Note"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
        <select value={form.farmId} onChange={(e) => setForm({ ...form, farmId: e.target.value })}>
          {farms.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <button className="green" onClick={addEntry}>Add</button>
      </div>

      {/* Ledger table */}
      <table className="table">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th><th>Amount</th></tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.createdAt).toLocaleDateString()}</td>
              <td>{e.type === 'expense' ? '🔴 out' : '🟢 in'}</td>
              <td>{e.category.replace('_', ' ')}</td>
              <td>{e.note ?? '—'}</td>
              <td style={{ fontWeight: 700 }}>
                {e.type === 'expense' ? '−' : '+'}
                {e.amount.toLocaleString()} {e.currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
