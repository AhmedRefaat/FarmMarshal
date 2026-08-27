/**
 * events.ts — CROSS-CUTTING: in-process event bus (ADR-006)
 * ---------------------------------------------------------------------------
 * Modules communicate without importing each other:
 *   issues → 'issue.stage_changed'   entitlements → 'subscription.activated'
 * Extracting a module to a microservice later = swap `emit` for a broker
 * publish; subscribers keep the same signatures.
 *
 * REQUIREMENT TRACEABILITY
 * ------------------------
 *   - docs/ARCHITECTURE_EVOLUTION_PLAN.md ADR-006 (modular monolith + event bus)
 *   - docs/V2_REQUIREMENTS_ANALYSIS.md §F4a (extensibility foundation)
 */

export type DomainEvent =
  | { type: 'issue.created'; issueId: string; farmId: string; kind: string }
  | { type: 'issue.stage_changed'; issueId: string; from: string; to: string; actorId: string }
  | { type: 'subscription.activated'; farmId: string; planId: string }
  | { type: 'message.created'; conversationId: string; messageId: string }
  | { type: 'video.ready'; videoId: string; farmId: string; areaTag?: string }
  | { type: 'leak.suspected'; farmId: string; deviceId: string; detail: Record<string, unknown> };

type Handler<E extends DomainEvent['type']> = (
  payload: Extract<DomainEvent, { type: E }>
) => void;

/** topic → subscribed handlers. Synchronous, ordered, no re-entrancy guards needed at this scale. */
const handlers: { [T in DomainEvent['type']]: Handler<T>[] } = {
  'issue.created': [],
  'issue.stage_changed': [],
  'subscription.activated': [],
  'message.created': [],
  'video.ready': [],
  'leak.suspected': [],
};

/** Subscribe to a topic. @returns unsubscribe() for test cleanup. */
export function subscribe<E extends DomainEvent['type']>(type: E, fn: Handler<E>): () => void {
  handlers[type].push(fn as Handler<E>);
  return () => {
    const i = handlers[type].indexOf(fn as Handler<E>);
    if (i >= 0) handlers[type].splice(i, 1);
  };
}

/** Publish an event to all current subscribers. Never throws outward. */
export function emit(event: DomainEvent): void {
  for (const fn of handlers[event.type] as ((e: DomainEvent) => void)[]) {
    try {
      fn(event);
    } catch (err) {
      // A broken subscriber must not break the emitting use-case.
      console.error('[events] handler failed', event.type, err);
    }
  }
}
