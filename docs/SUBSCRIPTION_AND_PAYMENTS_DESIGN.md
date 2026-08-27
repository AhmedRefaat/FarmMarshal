# Subscriptions, Feature Entitlements & Payments — Design

**Version:** 1.0 · **Date:** 2026-08-25 · **Status:** DESIGN (agreed decision: all premium
options are enabled/disabled according to the land owner's subscription plan)

> Governing rule from the owner: **"all options shall be enabled and disabled based on the
> subscription value and plan that the land owner selected."** This applies to everything:
> translation providers, IoT modules, video storage, marketplace access, report depth.

---

## 1. Plan model

```sql
plans(id, code UNIQUE, name, monthly_egp, currency, metadata JSONB)
plan_features(plan_id, feature_key, enabled BOOLEAN, limits JSONB)
  -- feature_key examples + limit shapes:
  -- 'water_iot'        {maxDevices: 50}
  -- 'solar_iot'        {maxPanels: 500}
  -- 'chat_translation' {provider:'google'|'deepl', monthlyChars: 100000}
  -- 'video_platform'   {storageGb: 50, retentionDays: 90}
  -- 'robot_integration'{enabled:true}
  -- 'marketplace'      {canAsk:true, canAnswer:false}
  -- 'reports'          {periods:['daily','weekly','monthly','yearly']}
subscriptions(id, farm_id, plan_id, status ENUM('trial','active','past_due','cancelled'),
              period_start, period_end, auto_renew)
entitlement_state(farm_id)  -- materialized view/cache recomputed on subscription change
```

Example tiers (illustrative, pricing TBD with owner):

| Feature | Basic | Standard | Premium |
|---|---|---|---|
| Tasks/issues/chat (core) | ✓ | ✓ | ✓ |
| Water IoT | — | ✓ | ✓ |
| Solar IoT | — | ✓ | ✓ |
| Chat translation | Google tier | DeepL tier | DeepL + voice transcription |
| Video platform / robot | — | 50 GB / 90 d | 500 GB / 365 d |
| Crowdsourced experts | — | ask only | ask + priority |
| Reports | daily | + weekly/monthly | + yearly + CSV export |

## 2. Enforcement (server-side, always)

- One middleware: `requireEntitlement(featureKey)` — every gated route calls it; returns 402 with
  `upgradeRequired: true` payload so clients show an upsell screen.
- Translation provider resolution: entitlement picks provider per request
  (`provider = entitlements.chat_translation.provider`) — both adapters stay implemented;
  the **subscription decides which is active**, matching your "both options based on budget" answer.
- Downgrade policy: data is never deleted; features turn off (read-only where sensible).
  e.g., video over retention limit → expired segments archived then purged by lifecycle rule.
- Clients hide gated UI too, but hiding is cosmetic only (same principle as RBAC).

**Tests:** matrix test plans × gated endpoints (402 vs 200); mid-cycle downgrade flips access within
60 s; translation falls back to cheaper provider when char quota exhausted; storage cap blocks new
uploads but keeps playback of existing.

## 3. Payments inbound (owner pays subscription)

Two rails, staged:

### Stage 1 (P0/P6): Manual ledger
Cash/bank-transfer with receipt photo → owner/admin records `payments(method='manual')` →
subscription activated manually. Zero integration risk; works day one.

### Stage 2: Card payments (Visa/Mastercard) with bank confirmation
```
POST /v2/payments/intent {planId}            → hosted checkout session (Paymob or Stripe —
                                               both support Visa/MC; final vendor at build time)
user pays on gateway page → gateway/bank confirms via signed webhook
POST /v2/payments/webhook    (idempotent by event id; verifies signature; marks payment paid,
                              extends subscriptions.period_end, emits subscription.activated)
```
- Bank/gateway confirmation is authoritative; app never trusts client-side "success".
- Reconciliation report: intents vs confirmed vs failed, for the accountant role.
- Webhooks replayed safely (idempotency key = gateway event ID).

## 4. Payouts outbound (marketplace experts)

- Now: manual settlement — ledger rows `consultation_responses.payout_status` transitions
  (`none → pending → paid`) executed by admin after requester acceptance; exportable bank list.
- Later: same ledger feeds a payout rail (bank transfer file / wallets). Schema already carries
  the states, so switching to automated payouts requires no data migration.
