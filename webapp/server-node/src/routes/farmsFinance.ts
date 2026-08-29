/**
 * routes/farmsFinance.ts — R4 farm directory + R5 financial ledger
 *   GET  /farms                          → Farm[]            [caller's farms]
 *   GET  /finances?type=&category=&farmId= → FinanceEntry[]  [farm finance reader]
 *   POST /finances                       → FinanceEntry      [farm finance writer]
 *   GET  /finances/summary               → {byCategory:{...}, total}
 *
 * The accountant view = /finances filtered per farm (see ARCHITECTURE.md §10
 * R5). Amounts are always positive; `type` carries the sign.
 *
 * SECURITY (SEC-C04 / SEC-C05 / SEC-H01)
 * --------------------------------------
 * Farm scope is an AUTHORIZATION BOUNDARY, never an optional query filter.
 * Before this fix `GET /finances` with no `farmId` returned every tenant's
 * ledger to any `owner`, and `POST /finances` copied `farmId` straight out of
 * the request body. Both now derive the permitted set from the authenticated
 * actor's verified memberships and reject anything outside it.
 *
 * This module also kept a PRIVATE farm list (`farm-1`, `farm-2`) disjoint from
 * the canonical registry in store.ts (`f-1`). Two farm models meant tenancy
 * could not be enforced at all; the canonical registry is now the only source
 * of truth here.
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requirePermission, type ActorContext } from '../authz.js';
import { getFarm, getTask, listFarms } from '../store.js';
import { audit } from '../audit.js';
import { makeLogger } from '../logger.js';

const log = makeLogger('finance');

/** One ledger row. */
export interface FinanceEntry {
  id: string;
  farmId: string;
  /** 'expense' (money out) or 'income' (money in, e.g. harvest sale). */
  type: 'expense' | 'income';
  category: 'seeds' | 'fertilizer' | 'labor' | 'fuel' | 'equipment' | 'harvest_sale' | 'other';
  amount: number;
  currency: string;
  note?: string;
  /** Set when the spend was incurred fixing one specific task. */
  taskId?: string;
  createdById: string;
  createdAt: number;
}

const ENTRY_TYPES = new Set(['expense', 'income']);
const ENTRY_CATEGORIES = new Set([
  'seeds', 'fertilizer', 'labor', 'fuel', 'equipment', 'harvest_sale', 'other',
]);

// Dev store (same seam as store.ts — swap for Postgres later). Seeded against
// the canonical farm id so the demo ledger belongs to a farm that real
// memberships actually reference.
const entries: FinanceEntry[] = [
  { id: 'fe-1', farmId: 'f-1', type: 'expense', category: 'seeds', amount: 4200, currency: 'EGP', note: 'Wheat seed batch', createdById: 'u-mod', createdAt: Date.now() - 5 * 86400e3 },
  { id: 'fe-2', farmId: 'f-1', type: 'expense', category: 'labor', amount: 1500, currency: 'EGP', note: 'Weeding crew day rate', createdById: 'u-mod', createdAt: Date.now() - 2 * 86400e3 },
  { id: 'fe-3', farmId: 'f-1', type: 'income', category: 'harvest_sale', amount: 18000, currency: 'EGP', note: 'Tomato sale to market', createdById: 'u-owner', createdAt: Date.now() - 1 * 86400e3 },
  { id: 'fe-4', farmId: 'f-2', type: 'expense', category: 'fertilizer', amount: 9800, currency: 'EGP', note: 'Foliar micronutrients — spring flush', createdById: 'u-mod', createdAt: Date.now() - 20 * 86400e3 },
  { id: 'fe-5', farmId: 'f-2', type: 'income', category: 'harvest_sale', amount: 64000, currency: 'EGP', note: 'Navel orange first pick', createdById: 'u-owner', createdAt: Date.now() - 6 * 86400e3 },
  { id: 'fe-6', farmId: 'f-3', type: 'expense', category: 'equipment', amount: 15500, currency: 'EGP', note: 'Windbreak posts and netting', createdById: 'u-mod', createdAt: Date.now() - 5 * 86400e3 },
  // Task-linked spend: what the corrective action itself cost.
  { id: 'fe-7', farmId: 'f-1', type: 'expense', category: 'equipment', amount: 2750, currency: 'EGP', note: 'Replacement drip line and couplings', taskId: 't-1', createdById: 'u-mod', createdAt: Date.now() - 3 * 86400e3 },
  { id: 'fe-8', farmId: 'f-1', type: 'expense', category: 'labor', amount: 900, currency: 'EGP', note: 'Repair crew — half day', taskId: 't-1', createdById: 'u-mod', createdAt: Date.now() - 3 * 86400e3 },
  { id: 'fe-9', farmId: 'f-2', type: 'expense', category: 'labor', amount: 1800, currency: 'EGP', note: 'Emitter flush and pressure test', taskId: 't-4', createdById: 'u-mod', createdAt: Date.now() - 9 * 86400e3 },
];

/**
 * Ledger rows booked against one task, oldest first.
 * Callers MUST have already authorized access to that task — this helper does
 * no scoping of its own.
 */
export function financeEntriesForTask(taskId: string): FinanceEntry[] {
  return entries
    .filter((e) => e.taskId === taskId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Least privilege for financial data, derived from verified memberships only:
 *
 *   admin      — platform administration, every farm
 *   farm owner — read and write
 *   moderator  — read and write (records field spend)
 *   accountant — read only (the reviewer persona)
 *   worker     — neither
 *
 * A caller-supplied identifier never contributes to either set.
 */
function financeScope(actor: ActorContext): { readable: Set<string>; writable: Set<string> } {
  if (actor.personas.includes('admin')) {
    const all = new Set(listFarms().map((f) => f.id));
    return { readable: all, writable: all };
  }
  const readable = new Set<string>(actor.ownedFarmIds);
  const writable = new Set<string>(actor.ownedFarmIds);
  for (const [farmId, roleInFarm] of actor.memberships) {
    if (roleInFarm === 'owner' || roleInFarm === 'moderator') {
      readable.add(farmId);
      writable.add(farmId);
    } else if (roleInFarm === 'accountant') {
      readable.add(farmId);
    }
  }
  return { readable, writable };
}

/**
 * Resolve the farms a request may touch.
 * @returns the effective set, or null when the caller asked for a farm outside
 *          their scope or holds no financial access at all.
 */
function effectiveScope(permitted: Set<string>, requestedFarmId?: string): string[] | null {
  if (requestedFarmId) {
    return permitted.has(requestedFarmId) ? [requestedFarmId] : null;
  }
  return permitted.size > 0 ? [...permitted] : null;
}

export default async function farmFinanceRoutes(app: FastifyInstance) {
  /**
   * Farm list for selectors. `requirePermission()` authenticates and attaches
   * `request.actor`; the tenant decision below is the authorization step and is
   * made explicitly in the handler, never inferred from the guard.
   */
  app.get('/farms', { preHandler: requirePermission() }, async (request) => {
    const actor = (request as any).actor as ActorContext;
    if (actor.personas.includes('admin')) return listFarms();
    const mine = new Set([...actor.ownedFarmIds, ...actor.memberships.keys()]);
    return [...mine].map(getFarm).filter(Boolean);
  });

  /** Ledger listing with optional filters — the accountant's main query. */
  app.get('/finances', { preHandler: requirePermission() }, async (request, reply) => {
    const actor = (request as any).actor as ActorContext;
    const q = request.query as Record<string, string>;
    const scope = effectiveScope(financeScope(actor).readable, q.farmId || undefined);
    if (!scope) {
      log.warn('finance read denied', {
        by: actor.userId,
        requestedFarmId: q.farmId,
        correlationId: (request as any).correlationId,
      });
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const allowed = new Set(scope);
    return entries
      .filter(
        (e) =>
          allowed.has(e.farmId) &&
          (!q.type || e.type === q.type) &&
          (!q.category || e.category === q.category)
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  });

  /** Append a ledger row (expense logged from the field or office). */
  app.post('/finances', { preHandler: requirePermission() }, async (request, reply) => {
    const actor = (request as any).actor as ActorContext;
    const b = request.body as any;
    if (!b?.type || !b?.category || typeof b.amount !== 'number' || !b?.farmId) {
      return reply.code(400).send({ error: 'farmId, type, category, amount required' });
    }
    if (!ENTRY_TYPES.has(b.type) || !ENTRY_CATEGORIES.has(b.category)) {
      return reply.code(400).send({ error: 'unknown type or category' });
    }
    // typeof NaN and typeof Infinity are both 'number'; the range check alone
    // let either through into the ledger.
    if (!Number.isFinite(b.amount) || b.amount <= 0) {
      return reply.code(400).send({ error: 'amount must be a positive finite number' });
    }
    // SEC-C05: the body's farmId is a REQUEST, never a statement of ownership.
    if (!financeScope(actor).writable.has(b.farmId)) {
      log.warn('finance write denied', {
        by: actor.userId,
        requestedFarmId: b.farmId,
        correlationId: (request as any).correlationId,
      });
      return reply.code(403).send({ error: 'Forbidden' });
    }
    // A task reference must point at a real task on the SAME farm, otherwise
    // the ledger row would leak the existence of another tenant's work.
    if (b.taskId !== undefined) {
      if (typeof b.taskId !== 'string') {
        return reply.code(400).send({ error: 'taskId must be a string' });
      }
      const linked = getTask(b.taskId);
      if (!linked || linked.farmId !== b.farmId) {
        return reply.code(400).send({ error: 'taskId does not belong to this farm' });
      }
    }
    const entry: FinanceEntry = {
      id: randomUUID(),
      farmId: b.farmId,
      type: b.type,
      category: b.category,
      amount: b.amount,
      currency: b.currency ?? 'EGP',
      note: b.note,
      taskId: typeof b.taskId === 'string' ? b.taskId : undefined,
      createdById: actor.userId,
      createdAt: Date.now(),
    };
    entries.push(entry);
    // A ledger mutation with no trail is indistinguishable from a fabrication.
    // Amounts and notes are deliberately kept out of the audit detail.
    audit({
      actorId: actor.userId,
      persona: actor.personas.join('+'),
      action: 'finance.entry.create',
      targetType: 'finance_entry',
      targetId: entry.id,
      detail: { farmId: entry.farmId, type: entry.type, category: entry.category },
    });
    return reply.code(201).send(entry);
  });

  /** Aggregates powering the accountant KPI cards (per farm or global). */
  app.get('/finances/summary', { preHandler: requirePermission() }, async (request, reply) => {
    const actor = (request as any).actor as ActorContext;
    const q = request.query as Record<string, string>;
    const scope = effectiveScope(financeScope(actor).readable, q.farmId || undefined);
    if (!scope) {
      log.warn('finance summary denied', {
        by: actor.userId,
        requestedFarmId: q.farmId,
        correlationId: (request as any).correlationId,
      });
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const allowed = new Set(scope);
    const scoped = entries.filter((e) => allowed.has(e.farmId));
    // Sum expenses and incomes separately, then group by category.
    let totalExpense = 0;
    let totalIncome = 0;
    const byCategory: Record<string, number> = {};
    for (const e of scoped) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
      if (e.type === 'expense') totalExpense += e.amount;
      else totalIncome += e.amount;
    }
    return { totalExpense, totalIncome, net: totalIncome - totalExpense, byCategory };
  });
}
