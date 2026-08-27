/**
 * flags.ts — CROSS-CUTTING: runtime feature flags per farm
 * ---------------------------------------------------------------------------
 * Orthogonal to entitlements: flags toggle features DURING rollout
 * ("beta for Farm 3") while entitlements gate by PLAN. Both must pass.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/ARCHITECTURE_EVOLUTION_PLAN.md §3 (cross-cutting feature flags)
 *   - docs/V2_REQUIREMENTS_ANALYSIS.md §F4a (dynamic-system requirement)
 */

import { randomUUID } from 'node:crypto';
import { getFlags, setFlag } from './store.js';

export interface FeatureFlag {
  id: string;
  key: string;
  /** null = global; otherwise applies to one farm only. */
  farmId: string | null;
  enabled: boolean;
}

/** Global flag check (farm-specific overrides win). */
export function isEnabled(key: string, farmId?: string): boolean {
  const all = getFlags().filter((f) => f.key === key);
  if (farmId) {
    const specific = all.find((f) => f.farmId === farmId);
    if (specific) return specific.enabled;
  }
  const global = all.find((f) => f.farmId === null);
  return global?.enabled ?? false;
}

/** Admin mutation path (route guarded by authz 'flag.manage'). */
export function upsertFlag(key: string, farmId: string | null, enabled: boolean): FeatureFlag {
  return setFlag({ id: randomUUID(), key, farmId, enabled });
}
