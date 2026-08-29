//! routes/mod.rs — FULL REST surface, byte-compatible with server-node
//! ===========================================================================
//! One handler per Node route, same paths, same JSON shapes, same status codes,
//! same error payloads ({error, code?, upgradeRequired?}). Sections cite the
//! mirrored Node module so reviewers can diff behaviour line-for-line.
//!
//! LOGGING: every guard denial (warn) and business milestone (info) mirrors
//! the Node scopes (`authz`, `agri`, `community`, `chat`, `http`, `boot`).

use crate::agri;
use crate::auth;
use crate::authz::{self, Action};
use crate::issues;
use crate::logger::make_logger;
use crate::store::Db;
use crate::DbState;
use crate::types::*;
use axum::{
    extract::{Multipart, Path, Query, State, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::collections::HashMap;

const L: fn(&'static str) -> crate::logger::Logger = make_logger;

type App = State<DbState>;

// ---------------------------------------------------------------------------
// Small helpers shared by every handler
// ---------------------------------------------------------------------------

fn ok_json(v: Value) -> Response { (StatusCode::OK, Json(v)).into_response() }
fn created(v: Value) -> Response { (StatusCode::CREATED, Json(v)).into_response() }
fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "error": msg }))).into_response()
}
fn bearer(headers: &HeaderMap) -> Option<Session> {
    let h = headers.get("authorization")?.to_str().ok()?;
    let token = h.strip_prefix("Bearer ")?;
    auth::verify(token)
}
/// 401 unless a valid token; returns the Session for the handler.
fn must_auth(headers: &HeaderMap) -> Result<Session, Response> {
    bearer(headers).ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Unauthorized"))
}
fn actor_of(state: &DbState, user_id: &str) -> Option<authz::ActorContext> {
    authz::build_actor_context(&db_lock!(state), user_id)
}

/// Lock the global DB. Macro keeps call sites terse; never held across awaits
/// because all handlers that mutate do lock→mutate→drop synchronously.
macro_rules! db_lock {
    ($state:expr) => {
        $state.db.lock().unwrap()
    };
}
pub(crate) use db_lock;

/// Guard chain used by nearly every /v2 route:
/// authenticate → build actor → evaluate matrix action (+optional farm resolver).
/// Denials log at warn (security signal) exactly like the Node trail.
fn guard<F>(state: &DbState, headers: &HeaderMap, action: Action, farm: F) -> Result<(Session, authz::ActorContext), Response>
where
    F: FnOnce() -> Option<String>,
{
    let session = must_auth(headers)?;
    let Some(actor) = actor_of(state, &session.user_id) else {
        return Err(err(StatusCode::UNAUTHORIZED, "Unknown user"));
    };
    let fid = farm();
    if !authz::can(&actor, action, fid.as_deref()) {
        L("authz").warn("permission denied", &[("action", "denied"), ("userId", &session.user_id)]);
        return Err(err(StatusCode::FORBIDDEN, &format!("Forbidden: {action:?}")));
    }
    L("authz").debug("permission granted", &[("userId", &session.user_id)]);
    Ok((session, actor))
}

/// Entitlement check mirroring requireEntitlement(): 402 + upgradeRequired on miss.
fn ensure_entitlement(state: &DbState, farm_id: Option<&str>, feature: &str) -> Result<(), Response> {
    let db = db_lock!(state);
    let active = db.subscriptions.iter().find(|s| {
        s.farm_id == farm_id.unwrap_or_default() && (s.status == "active" || s.status == "trial") && s.period_end > crate::util::now_ms()
    });
    let enabled = active
        .and_then(|s| db.plan_features.iter().find(|f| f.plan_id == s.plan_id && f.feature_key == feature))
        .map(|f| f.enabled)
        .unwrap_or(false);
    if !enabled {
        L("entitlements").warn("feature gated (402)", &[("feature", feature)]);
        return Err((StatusCode::PAYMENT_REQUIRED, Json(json!({"error":"Feature not available on your plan","upgradeRequired":true}))).into_response());
    }
    Ok(())
}

/// Resolve the caller's farm role label for stage-machine gates
/// (owner > membership > 'worker' fallback — exact parity with v2.ts).
fn farm_role_label(actor: &authz::ActorContext, state: &DbState, farm_id: &str) -> String {
    let db = db_lock!(state);
    if actor.personas.iter().any(|p| p == "admin") {
        return "admin".into();
    }
    if actor.owned_farm_ids.iter().any(|x| x == farm_id) {
        return "owner".into();
    }
    db.farm_members
        .iter()
        .find(|m| m.user_id == actor.user_id && m.farm_id == farm_id)
        .map(|m| m.role_in_farm.clone())
        .unwrap_or_else(|| "worker".into())
}

// ---------------------------------------------------------------------------
// Router assembly — every section maps to its Node module.
// ---------------------------------------------------------------------------
pub fn router(state: DbState) -> Router {
    Router::new()
        // health
        .route("/health", get(|| async { Json(json!({"ok": true})) }))
        // legacy core (routes/auth.ts, users.ts, tasks.ts, comments.ts, ratings.ts)
        .route("/auth/login", post(login))
        .route("/auth/register", post(register))
        .route("/users", get(list_users))
        .route("/users/:id/stats", get(user_stats))
        .route("/google/auth/exchange", any(google_unsupported))
        .route("/tasks", get(tasks_list).post(create_task))
        .route("/tasks/:id", get(get_task))
        .route("/tasks/:id/report", get(task_report))
        .route("/tasks/:id/status", axum::routing::patch(task_status))
        .route("/tasks/:id/photos", post(upload_photo))
        .route("/tasks/:id/comments", get(list_comments).post(post_comment))
        .route("/tasks/:id/comments/audio", post(post_audio_comment))
        .route("/ratings", post(post_rating).get(list_ratings))
        // P0 core (routes/v2.ts)
        .route("/v2/issues", post(create_issue).get(list_issues_v2))
        .route("/v2/issues/:id/stage", axum::routing::patch(advance_stage))
        .route("/v2/issues/:id/events", get(issue_timeline))
        .route("/v2/farms", get(my_farms))
        .route("/v2/farms/:id/entitlements", get(farm_entitlements))
        .route("/v2/personas", get(my_personas).post(switch_persona))
        .route("/v2/admin/personas/:userId/:persona", axum::routing::patch(admin_persona))
        .route("/v2/admin/subscriptions", post(assign_subscription))
        .route("/v2/audit", get(audit_list))
        .route("/v2/meta/stages", get(meta_stages))
        .route("/finances", get(list_finances).post(add_finance))
        .route("/finances/summary", get(finance_summary))
        .route("/v2/evidence", post(evidence_upload))
        .route("/v2/chat/:id/media", post(chat_media))
        .route("/v2/issues/:id/advance-with-evidence", post(advance_with_evidence))
        // P1–P7 features (routes/features.ts)
        .route("/ws", any(ws_gateway))
        .route("/v2/chat/conversations", post(new_conversation))
        .route("/v2/chat/inbox", get(chat_inbox))
        .route("/v2/chat/:id/messages", get(get_messages).post(send_msg))
        .route("/v2/chat/messages/:messageId/translate", post(translate_msg))
        .route("/v2/chat/messages/:messageId/pin", axum::routing::patch(pin_msg))
        .route("/v2/devices", post(add_device).get(list_devices_rt))
        .route("/v2/devices/:id/telemetry", post(ingest_telemetry))
        .route("/v2/devices/:id/valve", post(valve_control))
        .route("/v2/water/summary", get(water_summary_rt))
        .route("/v2/water/leak-scan", post(leak_scan))
        .route("/v2/solar/panels", post(add_panel))
        .route("/v2/solar/reports", get(solar_reports))
        .route("/v2/solar/daily-job", post(solar_daily_job))
        .route("/v2/trees", post(add_tree))
        .route("/v2/trees/resolve", get(resolve_tree_rt))
        .route("/v2/trees/:id/lifecycle-recommendation", get(tree_lifecycle))
        .route("/v2/trees/:id/events", post(tree_event))
        .route("/v2/videos", post(register_video_rt))
        .route("/v2/videos/:id/complete", post(complete_video_rt))
        .route("/v2/videos/:id/annotations", post(annotate).get(list_annotations_rt))
        .route("/v2/schedules", post(new_schedule).get(list_schedules_rt))
        .route("/v2/experts", get(list_experts))
        .route("/v2/experts/me", get(my_expert_card))
        .route("/v2/experts/apply", post(expert_apply))
        .route("/v2/experts/me/documents", post(expert_docs))
        .route("/v2/admin/verifications", get(verifications_queue))
        .route("/v2/admin/verifications/:id", axum::routing::patch(verify_expert))
        .route("/v2/consultations", post(post_consultation).get(list_consultations))
        .route("/v2/consultations/:id", get(consultation_detail))
        .route("/v2/consultations/:id/responses", post(respond_consultation))
        .route("/v2/consultations/:id/choose", axum::routing::patch(choose_response_rt))
        .route("/v2/consultations/:id/rate", post(rate_consultation))
        .route("/v2/cases", get(list_cases))
        .route("/v2/cases/publish", post(publish_case))
        .route("/v2/quizzes", get(list_quizzes).post(create_quiz_rt))
        .route("/v2/quizzes/:id/questions", post(add_question_rt))
        .route("/v2/quizzes/:id/attempts", post(submit_attempt))
        .with_state(state)
}

// ===========================================================================
// Legacy core — mirror of routes/auth.ts · users.ts · tasks.ts · comments.ts
// ===========================================================================

async fn login(State(state): App, headers: HeaderMap, Json(body): Json<Value>) -> Response {
    let _ = headers;
    let email = body["email"].as_str().unwrap_or("").to_lowercase();
    let password = body["password"].as_str().unwrap_or("");
    let db = db_lock!(state);
    // SEC-C3: constant-time hash verification replaces the former `p == password`
    // string compare against a plaintext store.
    match db.find_user_by_email(&email) {
        Some(u)
            if db
                .passwords
                .get(&email)
                .map(|stored| crate::security::verify_password(password, stored))
                .unwrap_or(false) =>
        {
            ok_json(json!({ "token": auth::issue_token(&u.id, &u.role), "user": u }))
        }
        _ => err(StatusCode::UNAUTHORIZED, "Invalid credentials"),
    }
}

/// Public self-service registration.
///
/// GAP-01 / SEC-C1: `role` used to be read straight from the body and inserted,
/// so an unauthenticated `{"role":"admin"}` created a platform administrator.
/// The role is now decided by the server — omitted or "worker" is accepted, any
/// other known role is 403, and an unrecognised value is 400.
async fn register(State(state): App, Json(body): Json<Value>) -> Response {
    let (Some(name), Some(email), Some(password)) = (
        body["name"].as_str(),
        body["email"].as_str(),
        body["password"].as_str(),
    ) else {
        return err(StatusCode::BAD_REQUEST, "name, email and password required");
    };

    let role = match crate::security::resolve_public_registration_role(body["role"].as_str()) {
        crate::security::RoleDecision::Allow(r) => r,
        crate::security::RoleDecision::Unknown => {
            return err(StatusCode::BAD_REQUEST, "role is not a recognised value");
        }
        crate::security::RoleDecision::Forbidden => {
            return err(
                StatusCode::FORBIDDEN,
                "role cannot be self-assigned; privileged roles are granted by an administrator",
            );
        }
    };

    if let Some(reason) = crate::security::validate_password_policy(password) {
        return err(StatusCode::BAD_REQUEST, reason);
    }

    let hashed = match crate::security::hash_password(password) {
        Ok(h) => h,
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "could not create account"),
    };

    let mut db = db_lock!(state);
    if db.find_user_by_email(email).is_some() {
        return err(StatusCode::CONFLICT, "Email already registered");
    }
    let id = db.next_id();
    let user = User { id: id.clone(), name: name.into(), email: email.into(), role: role.clone(), created_at: crate::util::now_ms() };
    db.users.insert(id.clone(), user.clone());
    db.passwords.insert(email.to_lowercase(), hashed);
    created(json!({ "token": auth::issue_token(&id, &role), "user": user }))
}

/// SEC — tenant scope for the directory: the caller plus everyone who shares at
/// least one farm with them. Platform `admin` is exempt because role
/// administration operates across tenants by definition.
fn visible_user_ids(db: &Db, user_id: &str) -> std::collections::HashSet<String> {
    let farms: std::collections::HashSet<&str> = db.farm_members.iter()
        .filter(|m| m.user_id == user_id).map(|m| m.farm_id.as_str()).collect();
    let mut ids: std::collections::HashSet<String> = std::collections::HashSet::from([user_id.to_string()]);
    for m in db.farm_members.iter().filter(|m| farms.contains(m.farm_id.as_str())) {
        ids.insert(m.user_id.clone());
    }
    ids
}

async fn list_users(State(state): App, headers: HeaderMap) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let db = db_lock!(state);
    if session.role == "admin" {
        return ok_json(serde_json::to_value(db.users.values().collect::<Vec<_>>()).unwrap());
    }
    let visible = visible_user_ids(&db, &session.user_id);
    ok_json(serde_json::to_value(db.users.values().filter(|u| visible.contains(&u.id)).collect::<Vec<_>>()).unwrap())
}

async fn user_stats(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let db = db_lock!(state);
    // Out-of-tenant reads are indistinguishable from "no such user".
    if session.role != "admin" && !visible_user_ids(&db, &session.user_id).contains(&id) {
        return err(StatusCode::NOT_FOUND, "User not found");
    }
    let rs: Vec<&Rating> = db.ratings.iter().filter(|r| r.ratee_id == id).collect();
    let count = rs.len();
    let avg = if count == 0 { 0.0 } else { (rs.iter().map(|r| r.stars as f64).sum::<f64>() / count as f64 * 10.0).round() / 10.0 };
    ok_json(json!({ "avgStars": avg, "count": count, "recent": rs }))
}

async fn tasks_list(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    let mut list: Vec<&Task> = db.tasks.values()
        .filter(|t| q.get("status").map_or(true, |s| t.status == *s))
        .filter(|t| q.get("workerId").map_or(true, |w| t.worker_id == *w))
        .collect();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    ok_json(serde_json::to_value(list).unwrap())
}

async fn get_task(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    db_lock!(state).tasks.get(&id).map(|t| ok_json(serde_json::to_value(t).unwrap()))
        .unwrap_or_else(|| err(StatusCode::NOT_FOUND, "Task not found"))
}

/// Full audit report for ONE task — everything that happened to it from the
/// moment it was reported until it was solved, in a single response so the
/// owner/moderator does not have to stitch four endpoints together.
/// Mirror of GET /tasks/:id/report in routes/tasks.ts.
async fn task_report(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    let Some(task) = db.tasks.get(&id) else { return err(StatusCode::NOT_FOUND, "Task not found") };
    // Identity fields safe to show inside a report — never the credential seam.
    let public_user = |uid: &str| -> Value {
        match db.users.get(uid) {
            Some(u) => json!({ "id": u.id, "name": u.name, "role": u.role }),
            None => Value::Null,
        }
    };
    let name_of = |uid: &str| db.users.get(uid).map(|u| u.name.clone()).unwrap_or_else(|| uid.to_string());
    // The issue that this task implements, if the workflow created one.
    let issue = db.issues.iter().find(|i| i.task_id.as_deref() == Some(task.id.as_str()));
    let mut comments: Vec<&Comment> = db.comments.iter().filter(|c| c.task_id == id).collect();
    comments.sort_by_key(|c| c.created_at);

    // Lifecycle stamps flattened into one ordered list for the timeline UI.
    // `by` is a display name (never an internal id) so the report reads as a
    // narrative without the client needing a second lookup.
    let stamps: [(&str, Option<u64>, String, Option<String>); 4] = [
        ("created", Some(task.created_at), name_of(&task.assignee_id), None),
        ("started", task.started_at, name_of(&task.worker_id), None),
        ("submitted", task.submitted_at, name_of(&task.worker_id), None),
        ("reviewed", task.reviewed_at, name_of(&task.assignee_id), task.review_note.clone()),
    ];
    let milestones: Vec<Value> = stamps.iter().filter_map(|(key, at, by, note)| {
        at.map(|at| { let mut v = json!({ "key": key, "at": at, "by": by }); if let Some(n) = note { v["note"] = json!(n); } v })
    }).collect();

    // What the corrective action cost. Only rows booked against THIS task —
    // the rest of the farm ledger stays behind /finances.
    let mut costs: Vec<Value> = db.schedules.iter()
        .filter(|s| s.get("ledger").is_some() && s["taskId"] == json!(task.id))
        .cloned().collect();
    costs.sort_by_key(|c| c["createdAt"].as_u64().unwrap_or(0));
    let sum = |kind: &str| -> f64 {
        costs.iter().filter(|c| c["type"] == json!(kind))
            .filter_map(|c| c["amount"].as_f64()).sum()
    };
    let (expense, income) = (sum("expense"), sum("income"));
    // A mixed-currency ledger cannot be summed; the demo is single-currency
    // and the first row decides the label.
    let currency = costs.first().and_then(|c| c["currency"].as_str()).unwrap_or("EGP").to_string();

    ok_json(json!({
        "task": task,
        "farm": issue.and_then(|i| db.farms.get(&i.farm_id)).map(|f| serde_json::to_value(f).unwrap()).unwrap_or(Value::Null),
        // "reporter" is whoever opened the work: the issue author when the task
        // came out of the 7-stage workflow, otherwise the assigning moderator.
        "reporter": public_user(issue.map(|i| i.created_by.as_str()).unwrap_or(task.assignee_id.as_str())),
        "assignee": public_user(&task.assignee_id),
        "worker": public_user(&task.worker_id),
        "issue": issue.map(|i| serde_json::to_value(i).unwrap()).unwrap_or(Value::Null),
        "issueEvents": issue.map(|i| db.issue_events.iter().filter(|e| e.issue_id == i.id).collect::<Vec<_>>()).unwrap_or_default(),
        "comments": comments,
        "milestones": milestones,
        "costs": costs,
        "costTotal": { "expense": expense, "income": income, "net": income - expense, "currency": currency },
    }))
}

async fn create_task(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    if !b["title"].is_string() || !b["workerId"].is_string() || !b["lat"].is_number() || !b["lng"].is_number() {
        return err(StatusCode::BAD_REQUEST, "title, workerId, lat and lng are required");
    }
    let mut db = db_lock!(state);
    let task = Task {
        id: db.next_id(), title: b["title"].as_str().unwrap().into(), description: b["description"].as_str().unwrap_or("").into(),
        lat: b["lat"].as_f64().unwrap(), lng: b["lng"].as_f64().unwrap(), status: "assigned".into(),
        assignee_id: session.user_id.clone(), worker_id: b["workerId"].as_str().unwrap().into(),
        before_photo_url: None, after_photo_url: None, before_photo_lat: None, before_photo_lng: None, after_photo_lat: None, after_photo_lng: None, review_note: None,
        created_at: crate::util::now_ms(), started_at: None, submitted_at: None, reviewed_at: None,
    };
    created(serde_json::to_value(&task).unwrap())
}

/// Lifecycle transitions — SAME rules table as routes/tasks.ts (start/submit/
/// approve/reject with per-action roles + from-states).
async fn task_status(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let action = b["action"].as_str().unwrap_or("");
    let mut rules: HashMap<&str, (Vec<&str>, &str, Vec<&str>, &str)> = HashMap::from([
        ("start", (vec!["assigned"], "in_progress", vec!["worker"], "startedAt")),
        ("submit", (vec!["in_progress"], "submitted", vec!["worker"], "submittedAt")),
        ("approve", (vec!["submitted"], "approved", vec!["moderator", "owner"], "reviewedAt")),
        ("reject", (vec!["submitted"], "rejected", vec!["moderator", "owner"], "reviewedAt")),
    ]);
    let Some((from, to, roles, ts)) = rules.remove(action) else {
        return err(StatusCode::BAD_REQUEST, "action must be one of start|submit|approve|reject");
    };
    if !roles.contains(&session.role.as_str()) {
        return err(StatusCode::FORBIDDEN, &format!("{} cannot perform '{}'", session.role, action));
    }
    let mut db = db_lock!(state);
    let Some(task) = db.tasks.get_mut(&id) else { return err(StatusCode::NOT_FOUND, "Task not found"); };
    if !from.contains(&task.status.as_str()) {
        return (StatusCode::CONFLICT, Json(json!({ "error": format!("cannot '{}' from status '{}'", action, task.status) }))).into_response();
    }
    task.status = to.into();
    let stamp = Some(crate::util::now_ms());
    match ts {
        "startedAt" => task.started_at = stamp,
        "submittedAt" => task.submitted_at = stamp,
        _ => {
            task.reviewed_at = stamp;
            if let Some(note) = b["note"].as_str() { task.review_note = Some(note.into()); }
        }
    }
    ok_json(serde_json::to_value(&*task).unwrap())
}

/// Evidence photo upload (R1): multipart with optional shutter-time GPS fields.
async fn upload_photo(State(state): App, Path(id): Path<String>, headers: HeaderMap, Query(q): Query<HashMap<String, String>>, mut mp: Multipart) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let kind = q.get("kind").cloned().unwrap_or_default();
    if kind != "before" && kind != "after" { return err(StatusCode::BAD_REQUEST, "kind must be 'before' or 'after'"); }
    let (url, lat, lng) = {
        {
            let db = db_lock!(state);
            let Some(task) = db.tasks.get(&id) else { return err(StatusCode::NOT_FOUND, "Task not found"); };
            if session.role == "worker" && task.worker_id != session.user_id {
                L("http").warn("photo upload denied (ownership)", &[("by", &session.user_id)]);
                return err(StatusCode::FORBIDDEN, "Forbidden");
            }
        } // guard dropped BEFORE any .await (MutexGuard is !Send across await points)
        let mut url = String::new();
        let mut lat = None; let mut lng = None;
        while let Ok(Some(field)) = mp.next_field().await {
            match field.name().unwrap_or("") {
                "file" => {
                    let data = field.bytes().await.unwrap_or_default();
                    let name = format!("{}.jpg", uuid::Uuid::new_v4());
                    let path = std::path::Path::new("uploads").join(&name);
                    tokio::fs::write(path, data).await.ok();
                    url = format!("/uploads/{name}");
                }
                "lat" => lat = field.text().await.ok().and_then(|v| v.parse().ok()),
                "lng" => lng = field.text().await.ok().and_then(|v| v.parse().ok()),
                _ => {}
            }
        }
        if url.is_empty() { return err(StatusCode::BAD_REQUEST, "multipart file required"); }
        (url, lat, lng)
    };
    let mut db = db_lock!(state);
    let task = db.tasks.get_mut(&id).unwrap();
    if kind == "before" {
        task.before_photo_url = Some(url.clone());
        task.before_photo_lat = lat; task.before_photo_lng = lng;
    } else {
        task.after_photo_url = Some(url.clone());
        task.after_photo_lat = lat; task.after_photo_lng = lng;
    }
    L("http").info("evidence photo stored", &[("taskId", &id), ("kind", &kind)]);
    ok_json(json!({ "url": url }))
}

async fn list_comments(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    let mut list: Vec<&Comment> = db.comments.iter().filter(|c| c.task_id == id).collect();
    list.sort_by_key(|c| c.created_at);
    ok_json(serde_json::to_value(list).unwrap())
}

async fn post_comment(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let name = db_lock!(state).users.get(&session.user_id).map(|u| u.name.clone()).unwrap_or_default();
    let mut db = db_lock!(state);
    let c = Comment { id: db.next_id(), task_id: id, author_id: session.user_id.clone(), author_name: name, author_role: session.role.clone(), text: b["text"].as_str().map(String::from), audio_url: None, created_at: crate::util::now_ms() };
    created(serde_json::to_value(&c).unwrap())
}

async fn post_audio_comment(State(state): App, Path(id): Path<String>, headers: HeaderMap, mut mp: Multipart) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let mut saved = None;
    while let Ok(Some(field)) = mp.next_field().await {
        if field.name() == Some("file") {
            let data = field.bytes().await.unwrap_or_default();
            let name = format!("{}.webm", uuid::Uuid::new_v4());
            tokio::fs::write(std::path::Path::new("uploads").join(&name), data).await.ok();
            saved = Some(format!("/uploads/{name}"));
        }
    }
    let Some(audio_url) = saved else { return err(StatusCode::BAD_REQUEST, "multipart file required"); };
    let name = db_lock!(state).users.get(&session.user_id).map(|u| u.name.clone()).unwrap_or_default();
    let mut db = db_lock!(state);
    let c = Comment { id: db.next_id(), task_id: id, author_id: session.user_id.clone(), author_name: name, author_role: session.role.clone(), text: None, audio_url: Some(audio_url), created_at: crate::util::now_ms() };
    created(serde_json::to_value(&c).unwrap())
}

async fn post_rating(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let (Some(ratee_id), Some(stars)) = (b["rateeId"].as_str(), b["stars"].as_u64()) else {
        return err(StatusCode::BAD_REQUEST, "rateeId and stars required");
    };
    let mut db = db_lock!(state);
    let ratee_role = db.users.get(ratee_id).map(|u| u.role.clone()).unwrap_or_default();
    // Central rule table (ARCHITECTURE.md §1): owner→mod/worker, mod→worker only.
    let allowed = (session.role == "owner" && (ratee_role == "moderator" || ratee_role == "worker"))
        || (session.role == "moderator" && ratee_role == "worker");
    if !allowed { return err(StatusCode::FORBIDDEN, "not permitted to rate this user"); }
    let r = Rating { id: db.next_id(), rater_id: session.user_id.clone(), ratee_id: ratee_id.into(), stars: stars.min(5) as u8, comment: b["comment"].as_str().map(String::from), created_at: crate::util::now_ms() };
    created(serde_json::to_value(&r).unwrap())
}

async fn list_ratings(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    let list: Vec<&Rating> = db.ratings.iter().filter(|r| q.get("rateeId").map_or(true, |x| r.ratee_id == *x)).collect();
    ok_json(serde_json::to_value(list).unwrap())
}

/// Documented divergence: Google OAuth token exchange is Node-only for now
/// (identity provider SDK); Rust returns an explicit 501 so clients can probe.
async fn google_unsupported() -> Response {
    err(StatusCode::NOT_IMPLEMENTED, "Google OAuth exchange is implemented on the Node trail only")
}

include!("v2core.rs");
include!("features.rs");
