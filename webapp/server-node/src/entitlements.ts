/**
 * entitlements.ts — DOMAIN MODULE: subscription-gated features (ADR-012)
 * ===========================================================================
 * OWNER RULE (verbatim intent): "all options shall be enabled and disabled
 * based on the subscription value and plan that the land owner selected."
 *
 * HOW A REQUEST IS JUDGED
 * -----------------------
 *   farm → active subscription? (trial/active + unexpired period)
 *        → plan's plan_features row for the requested key
 *        → enabled? limits?
 *   ANY miss ⇒ feature OFF (fail closed). No subscription, expired period,
 *   past_due, or missing feature row all resolve to disabled.
 *
 * ENFORCEMENT MODEL
 * -----------------
 * Server-side via `requireEntitlement(featureKey)` preHandler → HTTP 402 with
 * {upgradeRequired:true} so clients render an upsell screen. Client-side
 * hiding of UI is cosmetic ONLY (same principle as RBAC).
 *
 * DOWNGRADE POLICY
 * ----------------
 * Data is never deleted on downgrade; features turn off. e.g. video over a
 * lapsed retention limit is archived then purged by lifecycle rules, not lost
 * at the moment of downgrade.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/SUBSCRIPTION_AND_PAYMENTS_DESIGN.md §1–2
 *   - docs/V2_REQUIREMENTS_ANALYSIS.md F1/F2/F3/F4b/F6 (each gated module)
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FeatureKey } from './types.js';
import { getActiveSubscription, getPlanFeature } from './store.js';
import { makeLogger } from './logger.js';

// 402s are revenue-relevant signals: warn-level so they are visible in
// production dashboards without enabling debug noise.
const log = makeLogger('entitlements');

export interface Entitlement {
  enabled: boolean;
  limits?: Record<string, unknown>;
}

/**
 * Resolve the entitlement for ONE farm + feature.
 * No active/paid subscription or missing row → disabled (fail closed).
 */
export function entitlementFor(farmId: string | undefined, featureKey: FeatureKey): Entitlement {
  if (!farmId) return { enabled: false };
  const sub = getActiveSubscription(farmId);
  if (!sub || sub.status === 'past_due' || sub.status === 'cancelled') return { enabled: false };
  const pf = getPlanFeature(sub.planId, featureKey);
  if (!pf) return { enabled: false };
  return { enabled: pf.enabled, limits: pf.limits };
}

/** HTTP error payload shape for gated endpoints. */
const upgradePayload = { error: 'Feature not available on your plan', upgradeRequired: true };

/**
 * Fastify preHandler factory. The farm is resolved from (in order):
 *   1. explicit `farmIdResolver(request)` when provided (e.g. device→farm),
 *   2. :farmId param, ?farmId= query, or body field.
 */
export function requireEntitlement(
  featureKey: FeatureKey,
  farmIdResolver?: (request: FastifyRequest) => string | undefined
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as { farmId?: string } | null;   // ?farmId=…
    const b = request.body as { farmId?: string } | null;    // JSON body field
    const p = request.params as { farmId?: string } | null;  // :farmId path param
    const farmId = farmIdResolver?.(request) ?? p?.farmId ?? q?.farmId ?? b?.farmId;
    const ent = entitlementFor(farmId, featureKey);
    if (!ent.enabled) {
      log.warn('feature gated (402)', { featureKey, farmId, url: request.url });
      await reply.code(402).send(upgradePayload);
    }
  };
}
