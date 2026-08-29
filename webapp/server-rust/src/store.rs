//! store.rs — PERSISTENCE LAYER (repository)
//! ===========================================================================
//! EXACT mirror of `server-node/src/store.ts`: same collections, same seed
//! fixtures (including the intentional leak/dusty-panel/tree identity test
//! fixtures), same accessor surface. Postgres swap (ADR-004) re-implements
//! only this file — handlers never touch storage details.
//!
//! CONCURRENCY MODEL
//! -----------------
//! Everything lives in one `Db` behind `std::sync::Mutex` inside AppState.
//! Handlers lock briefly around read-modify-write, mirroring Node's
//! single-threaded mutation semantics. No lock crosses an `.await`.
//!
//! REQUIREMENT TRACEABILITY
//! ------------------------
//!   - ARCHITECTURE_EVOLUTION_PLAN.md §2 (DDL mirrors these shapes) · ADR-004

use crate::types::*;
use std::collections::HashMap;

/// The entire database — every collection mirrors the Node store 1:1.
pub struct Db {
    // Legacy v1
    pub users: HashMap<String, User>,
    pub passwords: HashMap<String, String>, // email -> PHC scrypt hash (SEC-C3)
    pub tasks: HashMap<String, Task>,
    pub comments: Vec<Comment>,
    pub ratings: Vec<Rating>,
    // P0
    pub farms: HashMap<String, Farm>,
    pub farm_members: Vec<FarmMember>,
    pub personas: Vec<UserPersona>,
    pub issues: Vec<Issue>,
    pub issue_events: Vec<IssueEvent>,
    pub plans: Vec<Plan>,
    pub plan_features: Vec<PlanFeature>,
    pub subscriptions: Vec<Subscription>,
    pub audit_log: Vec<AuditEntry>,
    // P1–P7
    pub conversations: Vec<Conversation>,
    pub messages: Vec<Message>,
    pub devices: HashMap<String, Device>,
    pub telemetry: Vec<Telemetry>, // bounded buffer; Timescale in production
    pub valve_commands: Vec<ValveCommand>,
    pub panels: Vec<Panel>,
    pub panel_reports: Vec<DailyPanelReport>,
    /// Tariff tiers per farm as raw JSON (tier math lives in agri.rs).
    pub tariffs: HashMap<String, serde_json::Value>,
    pub videos: HashMap<String, Video>,
    pub annotations: Vec<VideoAnnotation>,
    pub schedules: Vec<serde_json::Value>,
    pub trees: HashMap<String, Tree>,
    pub tree_events: Vec<TreeEvent>,
    pub species: HashMap<String, SpeciesProfile>,
    pub experts: Vec<ExpertProfile>,
    pub consultations: HashMap<String, Consultation>,
    pub consultation_responses: Vec<ConsultationResponse>,
    pub cases: Vec<LearningCase>,
    pub quizzes: Vec<Quiz>,
    pub questions: Vec<QuizQuestion>,
    pub attempts: Vec<QuizAttempt>,
    seq: u64,
}

impl Db {
    /// Monotonic id factory mirroring Node's `id-${++seq}`.
    pub fn next_id(&mut self) -> String {
        self.seq += 1;
        format!("id-{}", self.seq)
    }

    pub fn find_user_by_email(&self, email: &str) -> Option<&User> {
        let e = email.to_lowercase();
        self.users.values().find(|u| u.email.to_lowercase() == e)
    }
}

/// Boot-time seed — EXACT fixture parity with Node so both servers demo and
/// TEST identically (night-flow leak on dev-meter-1, dusty panel-B, tree
/// identity cases AGRI-TREE-0001 gps / 0002 relative-code).
pub fn seed() -> Db {
    let now = crate::util::now_ms();
    let mut db = Db {
        users: HashMap::new(), passwords: HashMap::new(), tasks: HashMap::new(),
        comments: Vec::new(), ratings: Vec::new(),
        farms: HashMap::new(), farm_members: Vec::new(), personas: Vec::new(),
        issues: Vec::new(), issue_events: Vec::new(), plans: Vec::new(),
        plan_features: Vec::new(), subscriptions: Vec::new(), audit_log: Vec::new(),
        conversations: Vec::new(), messages: Vec::new(), devices: HashMap::new(),
        telemetry: Vec::new(), valve_commands: Vec::new(), panels: Vec::new(),
        panel_reports: Vec::new(), tariffs: HashMap::new(), videos: HashMap::new(),
        annotations: Vec::new(), schedules: Vec::new(), trees: HashMap::new(),
        tree_events: Vec::new(), species: HashMap::new(), experts: Vec::new(),
        consultations: HashMap::new(), consultation_responses: Vec::new(),
        cases: Vec::new(), quizzes: Vec::new(), questions: Vec::new(),
        attempts: Vec::new(), seq: 100,
    };

    // Accounts (same emails/passwords as Node).
    for (id, name, email, role) in [
        ("u-owner", "Land Owner", "owner@agri.com", "owner"),
        ("u-mod", "Field Moderator", "moderator@agri.com", "moderator"),
        ("u-worker", "Field Worker", "worker@agri.com", "worker"),
        ("u-admin", "Platform Admin", "admin@agri.com", "admin"),
    ] {
        db.users.insert(id.into(), User { id: id.into(), name: name.into(), email: email.into(), role: role.into(), created_at: now });
        // SEC-C3: fixtures are hashed at seed time; the store never holds plaintext.
        let demo_secret = if id == "u-admin" { "admin123" } else { "pass123" };
        db.passwords.insert(
            email.to_lowercase(),
            crate::security::hash_password(demo_secret).expect("seed hash"),
        );
        db.personas.push(UserPersona { id: format!("p-{id}-{role}"), user_id: id.into(), persona: role.into(), status: "active".into(), created_at: now });
    }

    // Demo farm + memberships.
    db.farms.insert("f-1".into(), Farm { id: "f-1".into(), owner_id: "u-owner".into(), name: "Demo Nile Delta Farm".into(), center_lat: Some(30.05), center_lng: Some(31.23), created_at: now });
    for (fid, uid, role) in [("fm-owner", "u-owner", "owner"), ("fm-mod", "u-mod", "moderator"), ("fm-worker", "u-worker", "worker")] {
        db.farm_members.push(FarmMember { id: fid.into(), farm_id: "f-1".into(), user_id: uid.into(), role_in_farm: role.into(), created_at: now });
    }

    // Plans: basic / standard / premium (SUBSCRIPTION_AND_PAYMENTS_DESIGN §1).
    let feats = |code: &str| vec![
        ("reports", code != "basic"), ("water_iot", code != "basic"),
        ("solar_iot", code != "basic"), ("video_platform", code != "basic"),
        ("marketplace", code == "premium"), ("chat_translation", true),
        ("robot_integration", code == "premium"),
    ];
    for (pid, code, name, price) in [("pl-basic", "basic", "Basic", 0.0), ("pl-standard", "standard", "Standard", 500.0), ("pl-premium", "premium", "Premium", 1200.0)] {
        db.plans.push(Plan { id: pid.into(), code: code.into(), name: name.into(), monthly_egp: price, created_at: now });
        for (k, en) in feats(code) {
            db.plan_features.push(PlanFeature { plan_id: pid.into(), feature_key: k.into(), enabled: en });
        }
    }
    db.subscriptions.push(Subscription { id: "sub-1".into(), farm_id: "f-1".into(), plan_id: "pl-standard".into(), status: "active".into(), period_start: now - 86_400_000, period_end: now + 30 * 86_400_000, auto_renew: true, created_at: now });

    // Starter tasks (submitted + assigned) so dashboards are alive.
    db.tasks.insert("t-1".into(), Task { id: "t-1".into(), title: "Irrigation leak sector C".into(), description: "Main drip line leaking near valve C2; replace connector.".into(), lat: 30.05, lng: 31.23, status: "submitted".into(), assignee_id: "u-mod".into(), worker_id: "u-worker".into(), before_photo_url: Some(String::new()), after_photo_url: Some(String::new()), before_photo_lat: None, before_photo_lng: None, after_photo_lat: None, after_photo_lng: None, review_note: None, created_at: now - 86_400_000, started_at: Some(now - 82_800_000), submitted_at: Some(now - 7_200_000), reviewed_at: None });
    db.tasks.insert("t-2".into(), Task { id: "t-2".into(), title: "Weed control north field".into(), description: "Manual weeding rows 1–14.".into(), lat: 30.06, lng: 31.24, status: "assigned".into(), assignee_id: "u-mod".into(), worker_id: "u-worker".into(), before_photo_url: None, after_photo_url: None, before_photo_lat: None, before_photo_lng: None, after_photo_lat: None, after_photo_lng: None, review_note: None, created_at: now - 3_600_000, started_at: None, submitted_at: None, reviewed_at: None });

    // Mid-workflow starter issue.
    db.issues.push(Issue { id: "is-1".into(), farm_id: "f-1".into(), kind: "water_leak".into(), stage: "inspected".into(), source: "human_report".into(), title: "Suspected leak — main line sector C".into(), severity: "high".into(), task_id: Some("t-1".into()), created_by: "u-mod".into(), created_at: now - 43_200_000, closed_at: None, metadata: None });

    // Task-linked ledger rows: what the corrective action on t-1 cost.
    for (id, cat, amount, note) in [
        ("fe-7", "equipment", 2750.0, "Replacement drip line and couplings"),
        ("fe-8", "labor", 900.0, "Repair crew — half day"),
    ] {
        db.schedules.push(serde_json::json!({
            "id": id, "ledger": true, "farmId": "f-1", "taskId": "t-1",
            "type": "expense", "category": cat, "amount": amount,
            "currency": "SAR", "note": note,
            "createdBy": "u-mod", "createdAt": now - 10_800_000
        }));
    }

    // P2 water devices + tariff + 48h telemetry WITH night-flow leak fixture.
    db.devices.insert("dev-meter-1".into(), Device { id: "dev-meter-1".into(), farm_id: "f-1".into(), device_type: "water_meter".into(), vendor: Some("GenericPulse".into()), label: "Main line meter".into(), status: "online".into(), last_seen_at: Some(now), created_at: now });
    db.devices.insert("dev-valve-1".into(), Device { id: "dev-valve-1".into(), farm_id: "f-1".into(), device_type: "valve".into(), vendor: Some("GenericRelay".into()), label: "Valve C2".into(), status: "online".into(), last_seen_at: Some(now), created_at: now });
    db.tariffs.insert("f-1".into(), serde_json::json!([
        {"upToM3": 100, "pricePerM3": 2.5},
        {"upToM3": null, "pricePerM3": 4.0}
    ]));
    for h in (0..=47).rev() {
        let at = now - h * 3_600_000;
        // UTC hour window 00–05 = idle window (Node uses local; divergence documented).
        let hour = (at / 3_600_000) % 24;
        let night_idle = hour < 5;
        let mut metrics = HashMap::new();
        metrics.insert("m3_cumulative".into(), 1200.0 + (47 - h) as f64 * if night_idle { 0.8 } else { 6.0 });
        metrics.insert("flow_lpm".into(), if night_idle { 13.0 } else { 90.0 });
        db.telemetry.push(Telemetry { device_id: "dev-meter-1".into(), at, metrics });
    }

    // P3 solar string: A ok, B dusty (fixture), C ok.
    for sfx in ["A", "B", "C"] {
        db.panels.push(Panel { id: format!("panel-{sfx}"), farm_id: "f-1".into(), string_id: "str-1".into(), nameplate_kwp: 0.55 });
    }

    // P5 species + two identity-case trees.
    db.species.insert("mango-zebda".into(), SpeciesProfile { code: "mango-zebda".into(), expected_lifespan_years: 40.0 });
    db.species.insert("citrus-baladi".into(), SpeciesProfile { code: "citrus-baladi".into(), expected_lifespan_years: 25.0 });
    db.trees.insert("tr-1".into(), Tree { id: "tr-1".into(), farm_id: "f-1".into(), qr_code: "AGRI-TREE-0001".into(), species_code: "mango-zebda".into(), planted_at: now - (12.0 * 365.25 * 86_400_000.0) as u64, gps_accuracy_m: Some(6.0), location_method: "gps".into(), relative_code: None, status: "productive".into(), created_at: now });
    db.trees.insert("tr-2".into(), Tree { id: "tr-2".into(), farm_id: "f-1".into(), qr_code: "AGRI-TREE-0002".into(), species_code: "citrus-baladi".into(), planted_at: now - (24.0 * 365.25 * 86_400_000.0) as u64, gps_accuracy_m: None, location_method: "relative_code".into(), relative_code: Some("row-3/pos-7".into()), status: "productive".into(), created_at: now });

    db
}
