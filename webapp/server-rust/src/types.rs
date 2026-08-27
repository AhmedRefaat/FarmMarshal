//! types.rs — DOMAIN MODEL (Rust trail)
//! ===========================================================================
//! EXACT mirror of `server-node/src/types.ts` — the wire contract is shared,
//! so a client can switch servers by changing ONE base URL and nothing else.
//!
//! SERDE CONVENTION
//! ----------------
//! `#[serde(rename_all = "camelCase")]` everywhere: Rust struct fields are
//! snake_case but the JSON wire format stays camelCase exactly like Node.
//! Optional fields use Option + skip_serializing_if so absent === absent,
//! matching JavaScript's `undefined` semantics.
//!
//! REQUIREMENT TRACEABILITY
//! ------------------------
//! Each block cites its section in docs/V2_REQUIREMENTS_ANALYSIS.md, exactly
//! like the TS file does. Change the .ts FIRST, then mirror here.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Base entities (legacy v1 contract — kept byte-compatible)
// ---------------------------------------------------------------------------

pub type Role = String; // 'owner' | 'moderator' | 'worker' | 'admin'
pub type Persona = String; // G0.1b union incl. learner/crowd_expert/academic_expert

/// Session payload embedded in the signed token (mirrors auth.ts).
#[derive(Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(rename = "userId")]
    pub user_id: String,
    pub role: Role,
    pub exp: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: String,
    /// Primary persona; full set lives in user_personas (G0.1b).
    pub role: Role,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: String,
    pub lat: f64,
    pub lng: f64,
    pub status: String, // assigned|in_progress|submitted|approved|rejected
    pub assignee_id: String,
    pub worker_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_photo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_photo_url: Option<String>,
    /// R1 geo-evidence: shutter-time GPS stored beside each photo URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_photo_lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_photo_lng: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_photo_lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_photo_lng: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_note: Option<String>,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewed_at: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub task_id: String,
    pub author_id: String,
    pub author_name: String,
    pub author_role: Role,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_url: Option<String>,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rating {
    pub id: String,
    pub rater_id: String,
    pub ratee_id: String,
    pub stars: u8, // 1..=5 validated at the boundary
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    pub created_at: u64,
}

// ---------------------------------------------------------------------------
// P0 — personas / farms / issues / entitlements (G0.x)
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPersona {
    pub id: String,
    pub user_id: String,
    pub persona: Persona,
    pub status: String, // active|pending_verification|suspended
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Farm {
    pub id: String,
    pub owner_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center_lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center_lng: Option<f64>,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FarmMember {
    pub id: String,
    pub farm_id: String,
    pub user_id: String,
    pub role_in_farm: String,
    pub created_at: u64,
}

/// G0.2 universal workflow stage (7 stages, single forward steps only).
pub const STAGES: [&str; 7] = [
    "detected", "inspected", "identified", "recommended", "implemented", "reviewed", "closed",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub id: String,
    pub farm_id: String,
    pub kind: String,
    pub stage: String,
    pub source: String,
    pub title: String,
    pub severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub created_by: String,
    pub created_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>, // JSONB extensibility rule (F4a)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueEvent {
    pub id: String,
    pub issue_id: String,
    pub from_stage: String,
    pub to_stage: String,
    pub actor_id: String,
    pub actor_role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<serde_json::Value>,
    pub at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub code: String,
    pub name: String,
    #[serde(rename = "monthlyEgp")]
    pub monthly_egp: f64,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanFeature {
    pub plan_id: String,
    pub feature_key: String,
    pub enabled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub id: String,
    pub farm_id: String,
    pub plan_id: String,
    pub status: String,
    pub period_start: u64,
    pub period_end: u64,
    pub auto_renew: bool,
    pub created_at: u64,
}

/// Append-only compliance trail — runs even when LOG_LEVEL=off (see audit.rs note).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub at: u64,
    pub actor_id: String,
    pub persona: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
}

// ---------------------------------------------------------------------------
// P1 chat (F3) · P2 water (F1) · P3 solar (F2) · P4 video (F4b)
// P5 trees (F5) · P6 marketplace (F6) · P7 academy (F7)
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub farm_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consultation_id: Option<String>,
    pub member_ids: Vec<String>,
    pub created_by: String,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub sender_name: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_lang: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translations: Option<serde_json::Value>, // { lang: text } cache (F3)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_s: Option<u64>,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>, // offline outbox exactly-once (ADR-011)
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub farm_id: String,
    #[serde(rename = "type")]
    pub device_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    pub label: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<u64>,
    pub created_at: u64,
}

#[derive(Clone)]
pub struct Telemetry {
    pub device_id: String,
    pub at: u64,
    /// Canonical metrics map — vendor-neutral HAL shape (EVOLUTION_PLAN §10).
    pub metrics: HashMapLike,
}
pub type HashMapLike = std::collections::HashMap<String, f64>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValveCommand {
    pub id: String,
    pub device_id: String,
    pub action: String,
    pub requested_by: String,
    /// MANDATORY reason — why a valve moved is compliance data.
    pub reason: String,
    pub issued_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    pub id: String,
    pub farm_id: String,
    pub string_id: String,
    #[serde(rename = "nameplateKwp")]
    pub nameplate_kwp: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPanelReport {
    pub panel_id: String,
    pub date: String,
    #[serde(rename = "energyKwh")]
    pub energy_kwh: f64,
    #[serde(rename = "expectedKwh")]
    pub expected_kwh: f64,
    #[serde(rename = "siblingRatio")]
    pub sibling_ratio: f64,
    #[serde(rename = "cloudPct")]
    pub cloud_pct: f64,
    /// ok | suspect | confirmed — drives cleaning requests (F2).
    pub dust_status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: String,
    pub farm_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hls_url: Option<String>,
    pub status: String, // uploading|processing|ready|failed
    pub created_at: u64,
}

/// Timestamped expert annotation; optional treeId links into tree history.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoAnnotation {
    pub id: String,
    pub video_id: String,
    pub author_id: String,
    #[serde(rename = "tStartS")]
    pub t_start_s: f64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree_id: Option<String>,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tree {
    pub id: String,
    pub farm_id: String,
    /// PRIMARY identity: physical QR tag (GPS alone NEVER identifies a tree — F5).
    pub qr_code: String,
    pub species_code: String,
    pub planted_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gps_accuracy_m: Option<f64>,
    pub location_method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_code: Option<String>,
    pub status: String,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEvent {
    pub id: String,
    pub tree_id: String,
    pub event_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub at: u64,
}

#[derive(Clone)]
pub struct SpeciesProfile {
    pub code: String,
    pub expected_lifespan_years: f64,
}

/// Uber-style public reputation card (F6a).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpertProfile {
    pub id: String,
    pub user_id: String,
    pub institution: Option<String>,
    pub years_exp: Option<f64>,
    /// pending → verified | rejected | suspended (admin KYC gate).
    pub status: String,
    #[serde(rename = "avgStars")]
    pub avg_stars: f64,
    #[serde(rename = "answersCount")]
    pub answers_count: u32,
    #[serde(rename = "totalEarnedEgp")]
    pub total_earned_egp: f64,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Consultation {
    pub id: String,
    pub requester_id: String,
    pub question: String,
    #[serde(rename = "bountyEgp")]
    pub bounty_egp: f64,
    #[serde(rename = "platformCommissionPct")]
    pub platform_commission_pct: f64,
    pub scope: String,
    pub status: String, // open→chosen→settled (+disputed)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chosen_response_id: Option<String>,
    pub language: String,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsultationResponse {
    pub id: String,
    pub consultation_id: String,
    pub responder_id: String,
    pub answer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating_stars: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net_payout_egp: Option<f64>,
    pub payout_status: String, // none|pending|paid
    pub created_at: u64,
}

/// Frozen ANONYMIZED snapshot of a closed issue (ADR-020 — no later leakage).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningCase {
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub published_by: String,
    pub anonymized: bool,
    pub crop_tags: Vec<String>,
    pub status: String,
    pub snapshot: serde_json::Value,
    pub created_at: u64,
}

#[derive(Clone)]
pub struct QuizQuestion {
    pub id: String,
    pub quiz_id: String,
    pub q_type: String, // mcq|true_false|photo_diagnosis
    pub prompt: String,
    pub options: Vec<String>,
    /// SERVER-ONLY: never serialized to any client payload (ADR-021).
    pub answer_key: String,
    pub points: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quiz {
    pub id: String,
    pub title: String,
    pub author_id: String,
    #[serde(rename = "passThresholdPct")]
    pub pass_threshold_pct: f64,
    pub status: String,
    pub created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuizAttempt {
    pub id: String,
    pub quiz_id: String,
    pub user_id: String,
    #[serde(rename = "scorePct")]
    pub score_pct: f64,
    pub passed: bool,
    pub completed_at: u64,
}
