// ===========================================================================
// v2core.rs — P0 surface (mirror of src/routes/v2.ts)
// Included by routes/mod.rs so both files share helper scope.
// ===========================================================================

async fn create_issue(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok((session, _)) = guard(&state, &headers, Action::IssueCreate, || Some(b["farmId"].as_str().unwrap_or("").into())) else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    if !b["farmId"].is_string() || !b["kind"].is_string() || !b["title"].is_string() {
        return err(StatusCode::BAD_REQUEST, "farmId, kind and title are required");
    }
    let mut db = db_lock!(state);
    let iid = db.next_id();
    let eid = db.next_id();
    let issue = Issue {
        id: iid.clone(), farm_id: b["farmId"].as_str().unwrap().into(), kind: b["kind"].as_str().unwrap().into(),
        stage: "detected".into(), source: b["source"].as_str().unwrap_or("human_report").into(),
        title: b["title"].as_str().unwrap().into(), severity: b["severity"].as_str().unwrap_or("medium").into(),
        task_id: None, created_by: session.user_id.clone(), created_at: crate::util::now_ms(), closed_at: None,
        metadata: b.get("metadata").cloned(),
    };
    // PERSIST the issue (the bug the smoke test caught: returning without
    // storing made every later stage-advance 403 because it "didn't exist").
    db.issues.push(issue.clone());
    db.issue_events.push(IssueEvent { id: eid, issue_id: iid, from_stage: "detected".into(), to_stage: "detected".into(), actor_id: session.user_id.clone(), actor_role: session.role.clone(), note: Some("issue created".into()), evidence: None, at: crate::util::now_ms() });
    L("issues").info("issue created", &[("id", issue.id.as_str()), ("actor", session.user_id.as_str())]);
    created(serde_json::to_value(&issue).unwrap())
}

async fn list_issues_v2(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let Ok((session, _)) = guard(&state, &headers, Action::IssueView, || q.get("farmId").cloned()) else {
        return err(StatusCode::UNAUTHORIZED, "Unauthorized");
    };
    let _ = session;
    let db = db_lock!(state);
    let list: Vec<&Issue> = db.issues.iter()
        .filter(|i| q.get("farmId").map_or(true, |f| i.farm_id == *f))
        .filter(|i| q.get("kind").map_or(true, |k| i.kind == *k))
        .filter(|i| q.get("stage").map_or(true, |s| i.stage == *s))
        .collect();
    ok_json(serde_json::to_value(list).unwrap())
}

async fn advance_stage(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    // Farm resolved FROM THE ISSUE (IDOR guard — outsiders learn nothing).
    let fid = db_lock!(state).issues.iter().find(|i| i.id == id).map(|i| i.farm_id.clone());
    let (session, actor) = match guard(&state, &headers, Action::IssueAdvance, || fid.clone()) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let Some(to_stage) = b["toStage"].as_str().map(String::from) else {
        return err(StatusCode::BAD_REQUEST, "toStage required");
    };
    let Some(farm_id) = db_lock!(state).issues.iter().find(|i| i.id == id).map(|i| i.farm_id.clone()) else {
        return err(StatusCode::NOT_FOUND, "Issue not found");
    };
    let label = farm_role_label(&actor, &state, &farm_id);
    let is_admin = actor.personas.iter().any(|p| p == "admin");
    let mut db = db_lock!(state);
    match issues::advance(&mut db, &id, &to_stage, &session.user_id, is_admin, &label,
        b["note"].as_str(), b.get("evidence").cloned(), b["taskId"].as_str())
    {
        Ok(issue) => {
            let eid = db.next_id();
            db.audit_log.push(AuditEntry { id: eid, at: crate::util::now_ms(), actor_id: session.user_id.clone(), persona: label.clone(), action: "issue.stage_advance".into(), target_type: Some("issue".into()), target_id: Some(id.clone()) });
            L("issues").info("stage advanced", &[("to", &to_stage), ("role", &label)]);
            ok_json(serde_json::to_value(&issue).unwrap())
        }
        Err(e) => {
            let code = match e.code { "forbidden" => StatusCode::FORBIDDEN, "bad_stage" | "closed" => StatusCode::CONFLICT, _ => StatusCode::BAD_REQUEST };
            (code, Json(json!({ "error": e.message, "code": e.code }))).into_response()
        }
    }
}

async fn issue_timeline(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let fid = db_lock!(state).issues.iter().find(|i| i.id == id).map(|i| i.farm_id.clone());
    let _ = match guard(&state, &headers, Action::IssueView, || fid) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let db = db_lock!(state);
    let mut list: Vec<&IssueEvent> = db.issue_events.iter().filter(|e| e.issue_id == id).collect();
    list.sort_by_key(|e| e.at);
    ok_json(serde_json::to_value(list).unwrap())
}

async fn my_farms(State(state): App, headers: HeaderMap) -> Response {
    let (_, actor) = match guard(&state, &headers, Action::DeviceView, || None) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let db = db_lock!(state);
    let farms: Vec<&Farm> = db.farms.values()
        .filter(|f| actor.owned_farm_ids.contains(&f.id) || actor.memberships.iter().any(|(x, _)| x == &f.id))
        .collect();
    ok_json(serde_json::to_value(farms).unwrap())
}

/// Resolved plan switches for one farm (mirrors /v2/farms/:id/entitlements).
async fn farm_entitlements(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let (_, actor) = match guard(&state, &headers, Action::IssueView, || Some(id.clone())) {
        Ok(g) => g,
        Err(e) => return e,
    };
    if !authz::has_farm_access(&actor, Some(&id)) && !actor.personas.iter().any(|p| p == "admin") {
        return err(StatusCode::FORBIDDEN, "Forbidden: issue.view");
    }
    let db = db_lock!(state);
    let keys = ["water_iot", "solar_iot", "chat_translation", "video_platform", "robot_integration", "marketplace", "reports"];
    let active = db.subscriptions.iter().find(|s| s.farm_id == id && (s.status == "active" || s.status == "trial") && s.period_end > crate::util::now_ms());
    let obj: serde_json::Map<String, Value> = keys.iter().map(|k| {
        let en = active.and_then(|s| db.plan_features.iter().find(|f| f.plan_id == s.plan_id && f.feature_key == *k)).map(|f| json!(f.enabled)).unwrap_or(json!(false));
        ((*k).to_string(), json!({ "enabled": en }))
    }).collect();
    ok_json(Value::Object(obj))
}

async fn my_personas(State(state): App, headers: HeaderMap) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let db = db_lock!(state);
    let list: Vec<&UserPersona> = db.personas.iter().filter(|p| p.user_id == session.user_id).collect();
    ok_json(serde_json::to_value(list).unwrap())
}

async fn switch_persona(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let target = b["persona"].as_str().unwrap_or(session.role.as_str()).to_string();
    let mut db = db_lock!(state);
    let held = target == session.role
        || db.personas.iter().any(|p| p.user_id == session.user_id && p.persona == target && p.status == "active");
    if !held { return err(StatusCode::FORBIDDEN, &format!("persona '{target}' not active for this user")); }
    let eid = db.next_id();
    db.audit_log.push(AuditEntry { id: eid, at: crate::util::now_ms(), actor_id: session.user_id.clone(), persona: target.clone(), action: "persona.switch".into(), target_type: None, target_id: None });
    ok_json(json!({ "ok": true, "activePersona": target }))
}

async fn admin_persona(State(state): App, Path((user_id, persona)): Path<(String, String)>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = guard(&state, &headers, Action::PersonaVerify, || None) { return e; }
    let status = b["status"].as_str().unwrap_or("pending_verification").to_string();
    let mut db = db_lock!(state);
    let Some(row) = db.personas.iter_mut().find(|p| p.user_id == user_id && p.persona == persona) else {
        return err(StatusCode::NOT_FOUND, "persona not found");
    };
    row.status = status.clone();
    L("v2").warn("persona status changed", &[("userId", &user_id), ("status", &status)]);
    ok_json(serde_json::to_value(&*row).unwrap())
}

async fn assign_subscription(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = guard(&state, &headers, Action::SubscriptionAssign, || None) { return e; }
    let (Some(farm_id), Some(plan_id)) = (b["farmId"].as_str(), b["planId"].as_str()) else {
        return err(StatusCode::BAD_REQUEST, "farmId and planId required");
    };
    let days = b["days"].as_u64().unwrap_or(30);
    let now = crate::util::now_ms();
    let sub = Subscription { id: format!("sub-{}", uuid::Uuid::new_v4()), farm_id: farm_id.into(), plan_id: plan_id.into(), status: "active".into(), period_start: now, period_end: now + days * 86_400_000, auto_renew: true, created_at: now };
    // One active subscription per farm — supersede previous (parity with Node).
    let db_state = &state;
    { let mut db = db_lock!(db_state); db.subscriptions.retain(|s| s.farm_id != farm_id); db.subscriptions.push(sub.clone()); }
    L("v2").warn("subscription assigned", &[("farmId", farm_id), ("planId", plan_id)]);
    created(serde_json::to_value(&sub).unwrap())
}

async fn audit_list(State(state): App, headers: HeaderMap) -> Response {
    if let Err(e) = guard(&state, &headers, Action::AuditView, || None) { return e; }
    let db = db_lock!(state);
    let mut list: Vec<&AuditEntry> = db.audit_log.iter().collect();
    list.sort_by(|a, b| b.at.cmp(&a.at));
    ok_json(serde_json::to_value(list.into_iter().take(200).collect::<Vec<_>>()).unwrap())
}

async fn meta_stages() -> Response {
    ok_json(json!({ "stages": STAGES }))
}
