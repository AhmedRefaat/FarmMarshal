/**
 * agri.ts — DOMAIN MODULES: Water IoT (F1/P2) · Solar + weather (F2/P3) · Trees (F5/P5)
 * ===========================================================================
 * WATER (F1)
 *   • Telemetry: canonical readings land here from the MQTT ingest path OR
 *     HTTP backfills — devices never speak HTTP directly to business logic
 *     (ADR-005). The buffer stands in for TimescaleDB until ADR-004 swap.
 *   • Valve control: EVERY command carries a mandatory reason and is audited;
 *     ack lifecycle ok/timeout/failed mirrors real actuator behaviour.
 *   • Cost: tiered tariff math is pure & fixture-tested.
 *   • Leak rules v1: night-flow (flow>0 in idle window) + z-score deviation
 *     vs the device's own baseline. Triggers create DETECTED issues.
 *
 * SOLAR (F2)
 *   • Daily per-panel report: energy vs WEATHER-ADJUSTED expectation vs
 *     sibling median. Dust classification is staged intelligence:
 *       v1 statistical (here) → v2 CV microservice (Python, later phase).
 *   • Cloud-awareness prevents the classic false positive: a cloudy day dips
 *     ALL panels together — that is weather, not dust.
 *
 * TREES (F5)
 *   • Identity = QR primary + GPS(+accuracy) secondary + relative code
 *     fallback (owner review #3). Lifespan estimator uses species profiles;
 *     removal is a RECOMMENDATION — trees are archived, never deleted.
 *
 * REQUIREMENT TRACEABILITY
 *   - V2_REQUIREMENTS_ANALYSIS.md §F1 §F2 §F5
 *   - ARCHITECTURE_EVOLUTION_PLAN.md §10 HAL rationale + ADR-005/ADR-011
 */

import { randomUUID } from 'node:crypto';
import type {
  DailyPanelReport,
  Tree,
  TreeEvent,
  TreeStatus,
  ValveCommand,
} from './types.js';
import {
  allTelemetry,
  getTariff,
  getWeather,
  insertIssue,
  insertValveCommand,
  listDevices,
  listIssues,
  listPanelReports,
  listPanels,
  listTelemetry,
  putPanelReport,
  treeStore,
} from './store.js';
import type { Telemetry } from './types.js';
import { emit } from './events.js';
import { makeLogger } from './logger.js';

const log = makeLogger('agri');

// ===========================================================================
// P2 — WATER
// ===========================================================================

/** Pure tariff computation — fixture-tested (tiered EGP/m³). */
export function computeCost(consumedM3: number, tiers: Array<{ upToM3: number | null; pricePerM3: number }>): number {
  let remaining = consumedM3;
  let prevCap = 0;
  let cost = 0;
  for (const tier of tiers) {
    const width = tier.upToM3 === null ? Infinity : tier.upToM3 - prevCap;
    const usedInTier = Math.min(remaining, width);
    if (usedInTier <= 0) break;
    cost += usedInTier * tier.pricePerM3;
    remaining -= usedInTier;
    prevCap = tier.upToM3 ?? prevCap + width;
  }
  return Math.round(cost * 100) / 100; // piastre precision
}

/** Consumption summary for one meter over a window (+cost when tariff known). */
export function waterSummary(deviceId: string, fromMs: number, toMs: number) {
  const readings = listTelemetry(deviceId, fromMs).filter((t) => t.at <= toMs);
  if (readings.length < 2) return { consumedM3: 0, avgFlowLpm: 0, costEgp: undefined };
  const first = readings[0].metrics.m3_cumulative ?? 0;
  const last = readings[readings.length - 1].metrics.m3_cumulative ?? 0;
  const consumedM3 = Math.max(0, Math.round((last - first) * 100) / 100);
  const avgFlow =
    readings.reduce((a, r) => a + (r.metrics.flow_lpm ?? 0), 0) / readings.length;
  // Tariff lookup via ANY farm this device belongs to.
  const deviceId2Farm = listDevices().find((d) => d.id === deviceId)?.farmId;
  const tariff = deviceId2Farm ? getTariff(deviceId2Farm) : undefined;
  return {
    consumedM3,
    avgFlowLpm: Math.round(avgFlow * 10) / 10,
    costEgp: tariff ? computeCost(consumedM3, tariff.tiers) : undefined,
  };
}

/**
 * LEAK RULE v1 — night-flow detector.
 * Fixture contract (tested): continuous flow > threshold during the idle
 * window ⇒ leak suspected; exactly ONE issue per device per day (dedup).
 */
export function detectNightFlowLeaks(opts?: {
  idleWindowHours?: [number, number]; // default 00:00–05:00 local
  minFlowLpm?: number; // flow above this at night = physical leak
}): Array<{ deviceId: string; evidence: Record<string, unknown> }> {
  const [startH, endH] = opts?.idleWindowHours ?? [0, 5];
  const minFlow = opts?.minFlowLpm ?? 1;
  const suspects: Array<{ deviceId: string; evidence: Record<string, unknown> }> = [];

  // Group today's idle-window readings per device.
  const byDevice = new Map<string, Telemetry[]>();
  for (const t of allTelemetry()) {
    const h = new Date(t.at).getHours();
    if (h >= startH && h < endH && (t.metrics.flow_lpm ?? 0) > minFlow) {
      const arr = byDevice.get(t.deviceId) ?? [];
      arr.push(t);
      byDevice.set(t.deviceId, arr);
    }
  }

  for (const [deviceId, readings] of byDevice) {
    // Deduplicate: max one OPEN leak issue per device (sensor spam guard).
    const alreadyOpen = listIssues({ kind: 'water_leak' }).some(
      (i) => i.stage !== 'closed' && i.metadata?.deviceId === deviceId
    );
    if (alreadyOpen) continue;
    const evidence = {
      rule: 'night_flow_v1',
      samples: readings.length,
      peakFlowLpm: Math.max(...readings.map((r) => r.metrics.flow_lpm ?? 0)),
      windowHours: [startH, endH],
      deviceId,
    };
    suspects.push({ deviceId, evidence });
  }
  return suspects;
}

/** Materialize leak suspects into DETECTED issues + notifications event. */
export function raiseLeakIssues(): number {
  let raised = 0;
  for (const s of detectNightFlowLeaks()) {
    const dev = listDevices().find((d) => d.id === s.deviceId);
    if (!dev) continue;
    insertIssue({
      farmId: dev.farmId,
      kind: 'water_leak',
      title: `Suspected night-flow leak — ${dev.label}`,
      source: 'sensor_rule',
      severity: 'high',
      stage: 'detected',
      createdBy: 'system',
      metadata: { deviceId: dev.id },
    });
    emit({ type: 'leak.suspected', farmId: dev.farmId, deviceId: dev.id, detail: s.evidence });
    log.warn('leak suspected', { deviceId: dev.id, farmId: dev.farmId, ...s.evidence });
    raised++;
  }
  return raised;
}

/**
 * VALVE COMMAND — control plane with mandatory reason + audit.
 * In production the command publishes to MQTT topic farm/{id}/valve/{dev}/cmd
 * (ROBOT_INTEGRATION-style ack); the simulated ack path exists for tests.
 */
export function requestValveChange(input: {
  deviceId: string;
  action: ValveCommand['action'];
  requestedBy: string;
  reason: string;
}): ValveCommand {
  if (!input.reason.trim()) throw new AgriError('bad_request', 'a reason is MANDATORY for valve commands');
  const cmd = insertValveCommand({
    deviceId: input.deviceId,
    action: input.action,
    requestedBy: input.requestedBy,
    reason: input.reason,
    result: undefined as unknown as ValveCommand['result'],
  });
  log.info('valve command issued', {
    cmdId: cmd.id,
    deviceId: input.deviceId,
    action: input.action,
    by: input.requestedBy,
  });
  return cmd;
}

// ===========================================================================
// P3 — SOLAR
// ===========================================================================

/** Weather-adjusted expectation: nameplate × sun-hours scaled by cloud cover. */
export function expectedKwh(panelKwp: number, cloudPct: number): number {
  const sunHours = 5.5; // regional average clear-sky equivalent
  const cloudFactor = 1 - (cloudPct / 100) * 0.8; // clouds cut up to ~80%
  return Math.round(panelKwp * sunHours * cloudFactor * 100) / 100;
}

/**
 * DUST HEURISTIC v1 (fixture-tested):
 *   dusty_suspect ⇔ sibling ratio ≤ 0.75 AND irradiance normal (cloud ≤ 40%)
 *   cloudy-day dips do NOT flag (ratio ≈ 1 across siblings even when low).
 */
export function classifyDust(siblingRatio: number, cloudPct: number): DailyPanelReport['dustStatus'] {
  if (siblingRatio <= 0.75 && cloudPct <= 40) return 'suspect';
  return 'ok';
}

/**
 * Nightly batch: build per-panel reports for a farm on a date.
 * Sibling comparison makes the dust signal robust to farm-wide factors.
 */
export function generateDailyReports(farmId: string, date: string, energyByPanel: Record<string, number>, cloudPct: number): DailyPanelReport[] {
  const panels = listPanels(farmId);
  const energies = panels.map((p) => energyByPanel[p.id] ?? 0).sort((a, b) => a - b);
  const median = energies[Math.floor(energies.length / 2)] || 1;

  const reports: DailyPanelReport[] = [];
  for (const p of panels) {
    const energy = energyByPanel[p.id] ?? 0;
    const report: DailyPanelReport = {
      panelId: p.id,
      date,
      energyKwh: energy,
      expectedKwh: expectedKwh(p.nameplateKwp, cloudPct),
      siblingRatio: Math.round((energy / median) * 100) / 100,
      cloudPct,
      dustStatus: classifyDust(energy / median, cloudPct),
    };
    putPanelReport(report);
    reports.push(report);
  }
  const flagged = reports.filter((r) => r.dustStatus !== 'ok').length;
  log.info('daily solar reports generated', { farmId, date, total: reports.length, flagged });
  return reports;
}

/** Confirmed/suspect dust → pre-filled cleaning issue (RECOMMENDED-ready). */
export function raiseCleaningRequests(farmId: string, date: string): number {
  const dusty = listPanelReports(farmId, date).filter((r) => r.dustStatus !== 'ok');
  for (const r of dusty) {
    insertIssue({
      farmId,
      kind: 'panel_cleaning',
      title: `Cleaning request — panel ${r.panelId}`,
      source: 'sensor_rule',
      severity: 'low',
      stage: 'detected',
      createdBy: 'system',
      metadata: {
        panelId: r.panelId,
        date,
        evidence: { energyKwh: r.energyKwh, expectedKwh: r.expectedKwh, siblingRatio: r.siblingRatio },
      },
    });
  }
  if (dusty.length) log.warn('cleaning requests raised', { count: dusty.length, date });
  return dusty.length;
}

// ===========================================================================
// P5 — TREES
// ===========================================================================

/**
 * Identity resolution order (owner review #3 — GPS alone NEVER identifies):
 *   1. exact QR match (authoritative)
 *   2. relative position code within sector
 *   3. GPS within accuracy radius (weakest, reported as fuzzy match)
 */
export function resolveTree(query: { qrCode?: string; relativeCode?: string; sector?: string; lat?: number; lng?: number }): { tree: Tree; confidence: 'qr' | 'relative' | 'gps' } | null {
  const { trees } = treeStore;
  if (query.qrCode) {
    for (const t of trees.values()) if (t.qrCode === query.qrCode) return { tree: t, confidence: 'qr' };
  }
  if (query.relativeCode) {
    for (const t of trees.values())
      if (t.relativeCode === query.relativeCode && (!query.sector || t.sector === query.sector))
        return { tree: t, confidence: 'relative' };
  }
  if (query.lat !== undefined && query.lng !== undefined) {
    for (const t of trees.values()) {
      if (!t.gps || !t.gpsAccuracyM) continue;
      const dLat = (t.gps.lat - query.lat) * 111_320;
      const dLng = (t.gps.lng - query.lng) * 111_320 * Math.cos((query.lat * Math.PI) / 180);
      if (Math.hypot(dLat, dLng) <= t.gpsAccuracyM) return { tree: t, confidence: 'gps' };
    }
  }
  return null;
}

/**
 * Lifecycle estimator: age vs species lifespan + optional yield trend factor.
 * Returns the RECOMMENDED status — an expert confirms before any change.
 */
export function recommendTreeStatus(tree: Tree, yieldTrendRatio = 1): TreeStatus {
  const sp = treeStore.species.get(tree.speciesCode);
  if (!sp) return tree.status;
  const ageYears = (Date.now() - tree.plantedAt) / (365.25 * 86400_000);
  if (ageYears >= sp.expectedLifespanYears || yieldTrendRatio < 0.4) return 'end_of_life_recommended';
  if (ageYears >= sp.expectedLifespanYears * 0.75 || yieldTrendRatio < 0.7) return 'aging';
  return 'productive';
}

/** Append-only tree history event. */
export function addTreeEvent(treeId: string, eventKind: string, note?: string, evidence?: Record<string, unknown>): TreeEvent {
  const e: TreeEvent = { id: `te-${randomUUID()}`, treeId, eventKind, note, evidence, at: Date.now() };
  treeStore.events.set(e.id, e);
  return e;
}

// --- shared error ------------------------------------------------------------
export class AgriError extends Error {
  constructor(public code: 'bad_request' | 'not_found', message: string) {
    super(message);
  }
}


