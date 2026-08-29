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
import { useErrorMessage, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';

/** Ledger categories — the value is the wire enum, the label comes from the
 *  catalogue so nothing here is ever shown to a user verbatim. */
const CATEGORIES = [
  'seeds',
  'fertilizer',
  'labor',
  'fuel',
  'equipment',
  'harvest_sale',
  'other',
] as const;

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
  const { t, tc, fmt } = useI18n();
  const describeError = useErrorMessage();
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
    } catch (err) {
      setError(describeError(err));
    }
  }
  useEffect(() => {
    api.farms().then(setFarms).catch((e) => setError(describeError(e)));
  }, [describeError]);
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
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="pagehead">
        <p className="eyebrow">{t('finance.eyebrow')}</p>
        <h1>{t('finance.title')}</h1>
        <p>{t('finance.subtitle')}</p>
      </div>

      {/* Farm scope selector — the accountant reviews per farm */}
      <div className="chips">
        <button
          className={farmId === '' ? 'chip active' : 'chip'}
          onClick={() => setFarmId('')}
        >
          {t('finance.allFarms')}
        </button>
        {farms.map((f) => (
          <button
            key={f.id}
            className={farmId === f.id ? 'chip active' : 'chip'}
            onClick={() => setFarmId(f.id)}
          >
            <bdi>{tc(f.name)}</bdi>
          </button>
        ))}
      </div>

      {/* KPI cards from /finances/summary — currency is formatted by Intl so
          Arabic gets ر.س with Western digits rather than a bare number. */}
      {summary && (
        <div className="kpis">
          <div className="kpi red">
            <b>{fmt.currency(summary.totalExpense ?? 0)}</b>{' '}
            {t('finance.expenses')}
          </div>
          <div className="kpi green">
            <b>{fmt.currency(summary.totalIncome ?? 0)}</b>{' '}
            {t('finance.income')}
          </div>
          <div className="kpi orange">
            <b>{fmt.currency(summary.net ?? 0)}</b> {t('finance.net')}
          </div>
        </div>
      )}

      {/* Quick add-entry form */}
      <div className="row">
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="expense">{t('finance.typeExpense')}</option>
          <option value="income">{t('finance.typeIncome')}</option>
        </select>
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`finance.category.${c}` as MessageKey)}
            </option>
          ))}
        </select>
        <input
          placeholder={t('finance.amountPlaceholder')}
          type="number"
          style={{ width: 110 }}
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
        <input
          placeholder={t('finance.notePlaceholder')}
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
        <select value={form.farmId} onChange={(e) => setForm({ ...form, farmId: e.target.value })}>
          {farms.map((f) => (
            <option key={f.id} value={f.id}>{tc(f.name)}</option>
          ))}
        </select>
        <button className="green" onClick={addEntry}>{t('common.add')}</button>
      </div>

      {/* Ledger table */}
      <table className="table">
        <thead>
          <tr>
            <th>{t('common.date')}</th>
            <th>{t('common.type')}</th>
            <th>{t('common.category')}</th>
            <th>{t('common.note')}</th>
            <th>{t('common.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{fmt.date(e.createdAt)}</td>
              <td>
                {e.type === 'expense'
                  ? `🔴 ${t('finance.out')}`
                  : `🟢 ${t('finance.in')}`}
              </td>
              <td>{t(`finance.category.${e.category}` as MessageKey)}</td>
              <td><bdi>{tc(e.note) ?? t('common.none')}</bdi></td>
              <td style={{ fontWeight: 700 }}>
                {/* Sign + amount form one isolated run so the minus stays glued
                    to its number when the row renders right-to-left. */}
                <bdi>
                  {e.type === 'expense' ? '−' : '+'}
                  {fmt.currency(e.amount, e.currency)}
                </bdi>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
