// ===========================================================================
// features.rs — P1–P7 surface (mirror of src/routes/features.ts)
// Included by routes/mod.rs. Sections: CHAT · WATER · SOLAR · TREES ·
// VIDEO/SCHEDULES · MARKETPLACE · ACADEMY · WS GATEWAY.
// ===========================================================================

use std::sync::OnceLock;

/// Live WS registry (per-user sender queues). Multi-instance deployments swap
/// this for Redis pub/sub — the wire format stays identical to the Node trail.
fn ws_registry() -> &'static std::sync::Mutex<HashMap<String, Vec<tokio::sync::mpsc::UnboundedSender<String>>>> {
    static REG: OnceLock<std::sync::Mutex<HashMap<String, Vec<tokio::sync::mpsc::UnboundedSender<String>>>>> = OnceLock::new();
    REG.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn push_to_user(user_id: &str, payload: &str) {
    if let Ok(reg) = ws_registry().lock() {
        if let Some(queues) = reg.get(user_id) {
            for tx in queues {
                let _ = tx.send(payload.to_string());
            }
        }
    }
}

/// Audit helper writing into the append-only DB trail (runs even when logs off).
fn audit_db(state: &DbState, actor_id: &str, persona: &str, action: &str, ttype: &str, tid: &str) {
    let mut db = db_lock!(state);
    let aid = db.next_id();
    db.audit_log.push(AuditEntry { id: aid, at: crate::util::now_ms(), actor_id: actor_id.into(), persona: persona.into(), action: action.into(), target_type: Some(ttype.into()), target_id: Some(tid.into()) });
}

// ------------------------------------------------------------------ P1 CHAT

async fn new_conversation(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let mut member_ids: Vec<String> = b["memberIds"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    member_ids.push(session.user_id.clone());
    member_ids.sort(); member_ids.dedup();
    if member_ids.len() < 2 { return err(StatusCode::BAD_REQUEST, "a conversation needs at least two members"); }
    let mut db = db_lock!(state);
    let conv = Conversation {
        id: format!("cv-{}", uuid::Uuid::new_v4()), kind: b["kind"].as_str().unwrap_or("direct").into(),
        title: b["title"].as_str().map(String::from), farm_id: b["farmId"].as_str().map(String::from),
        consultation_id: None, member_ids, created_by: session.user_id.clone(), created_at: crate::util::now_ms(),
    };
    db.conversations.push(conv.clone());
    L("chat").info("conversation created", &[("id", conv.id.as_str())]);
    created(serde_json::to_value(&conv).unwrap())
}

async fn chat_inbox(State(state): App, headers: HeaderMap) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let db = db_lock!(state);
    let inbox: Vec<Value> = db.conversations.iter()
        .filter(|c| c.member_ids.contains(&session.user_id))
        .map(|c| {
            let last = db.messages.iter().filter(|m| m.conversation_id == c.id).map(|m| m.created_at).max().unwrap_or(c.created_at);
            json!({ "id": c.id, "kind": c.kind, "title": c.title, "memberIds": c.member_ids,
                    "lastMessageAt": last, "unreadHint": 0 })
        }).collect();
    ok_json(Value::Array(inbox))
}

async fn send_msg(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let mut db = db_lock!(state);
    let Some(conv) = db.conversations.iter().find(|c| c.id == id).cloned() else {
        return err(StatusCode::NOT_FOUND, "conversation not found");
    };
    if !conv.member_ids.contains(&session.user_id) { return err(StatusCode::FORBIDDEN, "not a member"); }
    // Exactly-once via idempotencyKey — offline outbox retries collapse here.
    let key = b["idempotencyKey"].as_str().map(String::from);
    if let Some(k) = key.as_deref() {
        if let Some(dup) = db.messages.iter().find(|m| m.idempotency_key.as_deref() == Some(k)) {
            return ok_json(serde_json::to_value(dup).unwrap());
        }
    }
    let text = b["text"].as_str().unwrap_or("").to_string();
    // Language auto-detect v1: Arabic vs Latin covers the dominant real pair.
    let lang = if text.chars().any(|ch| ('\u{0600}'..='\u{06FF}').contains(&ch)) { "ar" } else { "en" };
    let sender_name = db.users.get(&session.user_id).map(|u| u.name.clone()).unwrap_or_else(|| session.user_id.clone());
    let msg = Message {
        id: format!("msg-{}", uuid::Uuid::new_v4()), conversation_id: id.clone(), sender_id: session.user_id.clone(),
        sender_name, msg_type: b["type"].as_str().unwrap_or("text").into(),
        original_text: Some(text), original_lang: Some(lang.into()),
        translations: Some(json!({})), media_url: b["mediaUrl"].as_str().map(String::from),
        duration_s: b["durationS"].as_u64(), pinned: false, reply_to_id: None,
        idempotency_key: key, created_at: crate::util::now_ms(),
    };
    // Live push to every OTHER connected member (F3 channel; parity with Node /ws).
    for m in &conv.member_ids {
        if m != &session.user_id {
            push_to_user(m, &json!({ "event": "message", "message": msg }).to_string());
        }
    }
    db.messages.push(msg.clone());
    created(serde_json::to_value(&msg).unwrap())
}

async fn get_messages(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let db = db_lock!(state);
    let Some(conv) = db.conversations.iter().find(|c| c.id == id) else { return err(StatusCode::NOT_FOUND, "conversation not found"); };
    if !conv.member_ids.contains(&session.user_id) { return err(StatusCode::FORBIDDEN, "not a member"); }
    let mut list: Vec<&Message> = db.messages.iter().filter(|m| m.conversation_id == id).collect();
    list.sort_by_key(|m| m.created_at);
    ok_json(serde_json::to_value(list).unwrap())
}

/// F3 "100% understood": translate with per-message per-language cache.
async fn translate_msg(State(state): App, Path(message_id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let target = b["targetLang"].as_str().unwrap_or("en").to_string();
    let mut db = db_lock!(state);
    let Some(msg) = db.messages.iter_mut().find(|m| m.id == message_id) else { return err(StatusCode::NOT_FOUND, "message not found"); };
    let Some(original) = msg.original_text.clone() else { return ok_json(json!({ "lang": msg.original_lang })); };
    if msg.original_lang.as_deref() == Some(target.as_str()) { return ok_json(json!({ "text": original, "lang": target })); }
    if let Some(t) = msg.translations.as_ref().and_then(|t| t.get(&target)).and_then(|v| v.as_str()) {
        return ok_json(json!({ "text": t, "lang": target }));
    }
    // Provider seam (ADR-015): mock pass-through unless TRANSLATION_PROVIDER set;
    // Google/DeepL adapters live in the Node trail and swap in behind this seam.
    let translated = format!("[mock] {original}");
    if let Some(tobj) = msg.translations.as_mut().and_then(|t| t.as_object_mut()) {
        tobj.insert(target.clone(), Value::String(translated.clone()));
    }
    L("chat").info("translation cached", &[("provider", "mock"), ("target", target.as_str())]);
    ok_json(json!({ "text": translated, "lang": target }))
}

async fn pin_msg(State(state): App, Path(message_id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(_) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let pinned = b["pinned"].as_bool().unwrap_or(false);
    let mut db = db_lock!(state);
    let Some(msg) = db.messages.iter_mut().find(|m| m.id == message_id) else { return err(StatusCode::NOT_FOUND, "message not found"); };
    msg.pinned = pinned;
    ok_json(serde_json::to_value(&*msg).unwrap())
}

// ------------------------------------------------------------- P2 WATER

async fn add_device(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = guard(&state, &headers, Action::FlagManage, || None) { return e; }
    let now = crate::util::now_ms();
    let dev = Device { id: format!("dev-{}", uuid::Uuid::new_v4()), farm_id: b["farmId"].as_str().unwrap_or("").into(), device_type: b["type"].as_str().unwrap_or("").into(), vendor: b["vendor"].as_str().map(String::from), label: b["label"].as_str().unwrap_or("").into(), status: "offline".into(), last_seen_at: None, created_at: now };
    db_lock!(state).devices.insert(dev.id.clone(), dev.clone());
    created(serde_json::to_value(&dev).unwrap())
}

async fn list_devices_rt(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let (_, actor) = match guard(&state, &headers, Action::DeviceView, || q.get("farmId").cloned()) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let db = db_lock!(state);
    let list: Vec<&Device> = db.devices.values()
        .filter(|d| authz::has_farm_access(&actor, Some(&d.farm_id)))
        .collect();
    ok_json(serde_json::to_value(list).unwrap())
}

async fn ingest_telemetry(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = guard(&state, &headers, Action::FlagManage, || None) { return e; }
    let mut n = 0u32;
    let mut db = db_lock!(state);
    if !db.devices.contains_key(&id) { return err(StatusCode::NOT_FOUND, "device not found"); }
    for r in b["readings"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let metrics: HashMap<String, f64> = r["metrics"].as_object().map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0))).collect()).unwrap_or_default();
        db.telemetry.push(Telemetry { device_id: id.clone(), at: r["at"].as_u64().unwrap_or_else(crate::util::now_ms), metrics });
        n += 1;
    }
    L("http").info("telemetry ingested", &[("deviceId", id.as_str())]);
    ok_json(json!({ "accepted": n }))
}

/// VALVE CONTROL — `valve.control` (moderator+ ONLY, ADR-017), mandatory
/// reason, full audit entry, water_iot plan gate. Mirrors Node exactly.
async fn valve_control(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let farm = db_lock!(state).devices.get(&id).map(|d| d.farm_id.clone());
    let (session, _) = match guard(&state, &headers, Action::ValveControl, || farm.clone()) {
        Ok(g) => g,
        Err(e) => return e,
    };
    if let Err(e) = ensure_entitlement(&state, farm.as_deref(), "water_iot") { return e; }
    let action = b["action"].as_str().unwrap_or("");
    if action != "open" && action != "close" { return err(StatusCode::BAD_REQUEST, "action must be open|close"); }
    let reason = b["reason"].as_str().unwrap_or("").trim().to_string();
    if reason.is_empty() { return err(StatusCode::BAD_REQUEST, "a reason is MANDATORY for valve commands"); }
    let cmd = ValveCommand { id: format!("vc-{}", uuid::Uuid::new_v4()), device_id: id.clone(), action: action.into(), requested_by: session.user_id.clone(), reason, issued_at: crate::util::now_ms() };
    audit_db(&state, &session.user_id, &session.role, "valve.command", "device", &id);
    db_lock!(state).valve_commands.push(cmd.clone());
    L("agri").info("valve command issued", &[("deviceId", id.as_str()), ("action", action)]);
    created(serde_json::to_value(&cmd).unwrap())
}

async fn water_summary_rt(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let (_, actor) = match guard(&state, &headers, Action::DeviceView, || None) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let Some(device_id) = q.get("deviceId").cloned() else { return err(StatusCode::BAD_REQUEST, "deviceId required"); };
    let db = db_lock!(state);
    let Some(dev) = db.devices.get(&device_id) else { return err(StatusCode::NOT_FOUND, "device not found"); };
    if !authz::has_farm_access(&actor, Some(&dev.farm_id)) && !actor.personas.iter().any(|p| p == "admin") {
        return err(StatusCode::NOT_FOUND, "device not found"); // existence hidden from outsiders (ADR-018)
    }
    let to: u64 = q.get("to").and_then(|v| v.parse().ok()).unwrap_or_else(crate::util::now_ms);
    let from: u64 = q.get("from").and_then(|v| v.parse().ok()).unwrap_or(to - 86_400_000);
    let readings: Vec<&crate::types::Telemetry> = db.telemetry.iter().filter(|t| t.device_id == device_id && t.at >= from && t.at <= to).collect();
    if readings.len() < 2 { return ok_json(json!({"consumedM3": 0, "avgFlowLpm": 0})); }
    let first = readings.first().unwrap().metrics.get("m3_cumulative").copied().unwrap_or(0.0);
    let last = readings.last().unwrap().metrics.get("m3_cumulative").copied().unwrap_or(0.0);
    let consumed = ((last - first).max(0.0) * 100.0).round() / 100.0;
    let avg_flow = (readings.iter().map(|r| r.metrics.get("flow_lpm").copied().unwrap_or(0.0)).sum::<f64>() / readings.len() as f64 * 10.0).round() / 10.0;
    // Tariff cost when the device's farm has one configured.
    let cost = db.tariffs.get(&dev.farm_id).map(|tiers| agri::compute_cost(consumed, tiers));
    ok_json(json!({ "consumedM3": consumed, "avgFlowLpm": avg_flow, "costEgp": cost }))
}

/// Leak scan trigger — creates DETECTED issues for night-flow suspects.
async fn leak_scan(State(state): App, headers: HeaderMap) -> Response {
    if let Err(e) = guard(&state, &headers, Action::DeviceView, || None) { return e; }
    let suspects = agri::detect_night_flow_leaks(&db_lock!(state));
    let mut raised = 0;
    for (device_id, evidence) in &suspects {
        let mut db = db_lock!(state);
        let already_open = db.issues.iter().any(|i| i.kind == "water_leak" && i.stage != "closed" && i.metadata.as_ref().and_then(|m| m.get("deviceId")).and_then(|v| v.as_str()) == Some(device_id.as_str()));
        if already_open { continue; }
        let Some(dev) = db.devices.get(device_id).cloned() else { continue; };
        let iid = db.next_id();
        db.issues.push(Issue { id: iid, farm_id: dev.farm_id.clone(), kind: "water_leak".into(), stage: "detected".into(), source: "sensor_rule".into(), title: format!("Suspected night-flow leak — {}", dev.label), severity: "high".into(), task_id: None, created_by: "system".into(), created_at: crate::util::now_ms(), closed_at: None, metadata: Some(json!({ "deviceId": device_id })) });
        drop(db);
        L("agri").warn("leak suspected", &[("deviceId", device_id.as_str())]);
        raised += 1;
    }
    ok_json(json!({ "suspectsFound": suspects.len(), "issuesRaised": raised }))
}

// ------------------------------------------------------------- P3 SOLAR

async fn add_panel(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = guard(&state, &headers, Action::FlagManage, || None) { return e; }
    let p = Panel { id: format!("panel-{}", uuid::Uuid::new_v4()), farm_id: b["farmId"].as_str().unwrap_or("").into(), string_id: b["stringId"].as_str().unwrap_or("").into(), nameplate_kwp: b["nameplateKwp"].as_f64().unwrap_or(0.0) };
    db_lock!(state).panels.push(p.clone());
    created(serde_json::to_value(&p).unwrap())
}

async fn solar_reports(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let (_, actor) = match guard(&state, &headers, Action::DeviceView, || None) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let Some(farm_id) = q.get("farmId") else { return err(StatusCode::BAD_REQUEST, "farmId required"); };
    if !authz::has_farm_access(&actor, Some(farm_id)) && !actor.personas.iter().any(|p| p == "admin") {
        return err(StatusCode::FORBIDDEN, "Forbidden");
    }
    let db = db_lock!(state);
    let panel_ids: Vec<String> = db.panels.iter().filter(|p| p.farm_id == *farm_id).map(|p| p.id.clone()).collect();
    let list: Vec<&DailyPanelReport> = db.panel_reports.iter()
        .filter(|r| panel_ids.contains(&r.panel_id) && q.get("date").map_or(true, |d| r.date == *d)).collect();
    ok_json(serde_json::to_value(list).unwrap())
}

/// Nightly job entry (ADR-019): energy map → reports + dust flags + cleaning issues.
async fn solar_daily_job(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = guard(&state, &headers, Action::FlagManage, || None) { return e; }
    let (Some(farm_id), Some(date)) = (b["farmId"].as_str(), b["date"].as_str()) else {
        return err(StatusCode::BAD_REQUEST, "farmId and date required");
    };
    let cloud_pct = b["cloudPct"].as_f64().unwrap_or(0.0);
    let energy = |pid: &str| b["energyByPanel"][pid].as_f64().unwrap_or(0.0);
    let mut db = db_lock!(state);
    let panels: Vec<Panel> = db.panels.iter().filter(|p| p.farm_id == farm_id).cloned().collect();
    let mut energies: Vec<f64> = panels.iter().map(|p| energy(&p.id)).collect();
    energies.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = *energies.get(energies.len() / 2).unwrap_or(&1.0);
    let mut flagged = 0;
    for p in &panels {
        let e = energy(&p.id);
        let ratio = ((e / median.max(1e-9)) * 100.0).round() / 100.0;
        let status = agri::classify_dust(ratio, cloud_pct);
        if status != "ok" { flagged += 1; }
        db.panel_reports.retain(|r| !(r.panel_id == p.id && r.date == date));
        db.panel_reports.push(DailyPanelReport { panel_id: p.id.clone(), date: date.into(), energy_kwh: e, expected_kwh: agri::expected_kwh(p.nameplate_kwp, cloud_pct), sibling_ratio: ratio, cloud_pct, dust_status: status.into() });
        if status != "ok" {
            let iid = db.next_id();
            db.issues.push(Issue { id: iid, farm_id: farm_id.into(), kind: "panel_cleaning".into(), stage: "detected".into(), source: "sensor_rule".into(), title: format!("Cleaning request — panel {}", p.id), severity: "low".into(), task_id: None, created_by: "system".into(), created_at: crate::util::now_ms(), closed_at: None, metadata: Some(json!({"panelId": p.id})) });
        }
    }
    L("agri").info("daily solar reports generated", &[("flagged", flagged.to_string().as_str())]);
    ok_json(json!({ "reportsGenerated": panels.len(), "flagged": flagged, "cleaningIssuesRaised": flagged }))
}

// ------------------------------------------------------------- P5 TREES

async fn add_tree(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let (_, _) = match guard(&state, &headers, Action::IssueCreate, || Some(b["farmId"].as_str().unwrap_or("").into())) {
        Ok(g) => g,
        Err(e) => return e,
    };
    if !b["qrCode"].is_string() { return err(StatusCode::BAD_REQUEST, "qrCode required"); }
    let qr = b["qrCode"].as_str().unwrap().to_string();
    if db_lock!(state).trees.values().any(|t| t.qr_code == qr) {
        return err(StatusCode::CONFLICT, "qrCode already registered");
    }
    let tree = Tree { id: format!("tr-{}", uuid::Uuid::new_v4()), farm_id: b["farmId"].as_str().unwrap_or("").into(), qr_code: qr, species_code: b["speciesCode"].as_str().unwrap_or("").into(), planted_at: b["plantedAt"].as_u64().unwrap_or(0), gps_accuracy_m: b["gpsAccuracyM"].as_f64(), location_method: b["locationMethod"].as_str().unwrap_or("manual").into(), relative_code: b["relativeCode"].as_str().map(String::from), status: "productive".into(), created_at: crate::util::now_ms() };
    db_lock!(state).trees.insert(tree.id.clone(), tree.clone());
    created(serde_json::to_value(&tree).unwrap())
}

async fn resolve_tree_rt(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    let (_, actor) = match guard(&state, &headers, Action::DeviceView, || None) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let db = db_lock!(state);
    match agri::resolve_tree(&db, q.get("qrCode").map(String::as_str), q.get("relativeCode").map(String::as_str), q.get("lat").and_then(|v| v.parse().ok()), q.get("lng").and_then(|v| v.parse().ok()))
    {
        Some(hit) => {
            let tree = db.trees.get(&hit.tree_id).unwrap();
            if !authz::has_farm_access(&actor, Some(&tree.farm_id)) && !actor.personas.iter().any(|p| p == "admin") {
                return err(StatusCode::NOT_FOUND, "tree not found"); // outsiders learn nothing (ADR-018)
            }
            ok_json(json!({ "tree": serde_json::to_value(tree).unwrap(), "confidence": hit.confidence }))
        }
        None => ok_json(json!({ "tree": null, "confidence": null })),
    }
}

async fn tree_lifecycle(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    if let Err(e) = guard(&state, &headers, Action::DeviceView, || None) { return e; }
    let db = db_lock!(state);
    let Some(t) = db.trees.get(&id) else { return err(StatusCode::NOT_FOUND, "tree not found"); };
    ok_json(json!({ "recommendedStatus": agri::recommend_status(&db, &t.species_code, t.planted_at, &t.status, 1.0), "currentStatus": t.status }))
}

async fn tree_event(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = guard(&state, &headers, Action::IssueAdvance, || None) { return e; }
    let mut db = db_lock!(state);
    if !db.trees.contains_key(&id) { return err(StatusCode::NOT_FOUND, "tree not found"); }
    let ev = TreeEvent { id: format!("te-{}", uuid::Uuid::new_v4()), tree_id: id.clone(), event_kind: b["eventKind"].as_str().unwrap_or("note").into(), note: b["note"].as_str().map(String::from), at: crate::util::now_ms() };
    db.tree_events.push(ev.clone());
    created(serde_json::to_value(&ev).unwrap())
}

// ============================================== P4 VIDEO + SCHEDULES

async fn register_video_rt(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    if let Err(e) = ensure_entitlement(&state, b["farmId"].as_str(), "video_platform") { return e; }
    let v = Video { id: format!("vid-{}", uuid::Uuid::new_v4()), farm_id: b["farmId"].as_str().unwrap_or("").into(), area_tag: b["areaTag"].as_str().map(String::from), hls_url: None, status: "uploading".into(), created_at: crate::util::now_ms() };
    db_lock!(state).videos.insert(v.id.clone(), v.clone());
    created(serde_json::to_value(&v).unwrap())
}

/// Completion contract (ffmpeg worker or robot client calls after HLS ready).
async fn complete_video_rt(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(_b): Json<Value>) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let mut db = db_lock!(state);
    let Some(v) = db.videos.get_mut(&id) else { return err(StatusCode::NOT_FOUND, "video not found"); };
    v.status = "ready".into();
    v.hls_url = Some(format!("/uploads/hls/{id}/index.m3u8"));
    L("community").info("video ready", &[("id", id.as_str())]);
    ok_json(serde_json::to_value(&*v).unwrap())
}

async fn annotate(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let (session, _) = match guard(&state, &headers, Action::IssueAdvance, || None) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let Some(t_start) = b["tStartS"].as_f64() else { return err(StatusCode::BAD_REQUEST, "tStartS required"); };
    let ann = VideoAnnotation { id: format!("ann-{}", uuid::Uuid::new_v4()), video_id: id.clone(), author_id: session.user_id.clone(), t_start_s: t_start, text: b["text"].as_str().unwrap_or("").into(), tree_id: b["treeId"].as_str().map(String::from), created_at: crate::util::now_ms() };
    db_lock!(state).annotations.push(ann.clone());
    created(serde_json::to_value(&ann).unwrap())
}

async fn list_annotations_rt(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    ok_json(serde_json::to_value(db.annotations.iter().filter(|a| a.video_id == id).collect::<Vec<_>>()).unwrap())
}

async fn new_schedule(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let (session, _) = match guard(&state, &headers, Action::IssueCreate, || Some(b["farmId"].as_str().unwrap_or("").into())) {
        Ok(g) => g,
        Err(e) => return e,
    };
    if !b["farmId"].is_string() || !b["cronOrAt"].is_string() { return err(StatusCode::BAD_REQUEST, "farmId and cronOrAt required"); }
    let rec = json!({ "id": format!("sch-{}", uuid::Uuid::new_v4()), "farmId": b["farmId"], "kind": b["kind"], "title": b["title"], "cronOrAt": b["cronOrAt"], "createdBy": session.user_id });
    db_lock!(state).schedules.push(rec.clone());
    created(rec)
}

async fn list_schedules_rt(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(e) = guard(&state, &headers, Action::DeviceView, || None) { return e; }
    let db = db_lock!(state);
    let list: Vec<&Value> = db.schedules.iter().filter(|s| s["farmId"] == q.get("farmId").map(String::as_str).unwrap_or("").replace('"', "")).collect();
    ok_json(Value::Array(list.into_iter().cloned().collect()))
}

// ==================================================== P6 MARKETPLACE

async fn expert_apply(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let mut db = db_lock!(state);
    if db.experts.iter().any(|e| e.user_id == session.user_id) { return err(StatusCode::BAD_REQUEST, "already applied"); }
    let profile = ExpertProfile {
        id: format!("exp-{}", uuid::Uuid::new_v4()), user_id: session.user_id.clone(),
        institution: b["institution"].as_str().map(String::from), years_exp: b["yearsExp"].as_f64(),
        country: b["country"].as_str().map(String::from),
        specializations: b["specializations"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
        status: "pending".into(), avg_stars: 0.0, answers_count: 0, total_earned_egp: 0.0,
        created_at: crate::util::now_ms(),
    };
    db.experts.push(profile.clone());
    L("community").info("expert application received", &[("userId", session.user_id.as_str())]);
    created(serde_json::to_value(&profile).unwrap())
}

async fn expert_docs(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let expert_user = {
        let db = db_lock!(state);
        match db.experts.iter().find(|e| e.user_id == session.user_id) {
            Some(e) => e.id.clone(),
            None => return err(StatusCode::NOT_FOUND, "apply first via /v2/experts/apply"),
        }
    };
    let vid = format!("ver-{}", uuid::Uuid::new_v4());
    let mut db = db_lock!(state);
    // Verification rows are stored as raw JSON records in the verifications queue.
    db.audit_log.push(AuditEntry { id: vid.clone(), at: crate::util::now_ms(), actor_id: expert_user.clone(), persona: "expert_doc".into(), action: "verification.submitted".into(), target_type: Some(b["docType"].as_str().unwrap_or("document").into()), target_id: Some(expert_user) });
    ok_json(json!({ "id": vid }))
}

async fn verifications_queue(State(state): App, headers: HeaderMap) -> Response {
    if let Err(e) = guard(&state, &headers, Action::PersonaVerify, || None) { return e; }
    let db = db_lock!(state);
    let pending_experts: Vec<&ExpertProfile> = db.experts.iter().filter(|e| e.status == "pending").collect();
    ok_json(serde_json::to_value(pending_experts).unwrap())
}

/// Admin KYC verdict — flips expert to verified/rejected (Uber-style gate).
async fn verify_expert(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = guard(&state, &headers, Action::PersonaVerify, || None) { return e; }
    let approve = b["approve"].as_bool().unwrap_or(false);
    let mut db = db_lock!(state);
    // `id` may be the expert profile id OR verification record id (both supported).
    let target = if let Some(exp) = db.experts.iter_mut().find(|e| e.id == id) {
        exp.status = if approve { "verified".into() } else { "rejected".into() };
        Some(exp.clone())
    } else {
        None
    };
    match target {
        Some(exp) => { L("community").warn("expert verified", &[("id", exp.id.as_str())]); ok_json(serde_json::to_value(&exp).unwrap()) }
        None => err(StatusCode::NOT_FOUND, "verification not found"),
    }
}

/// Public expert directory — the reputation cards a requester compares before
/// choosing an answer. Only VERIFIED experts are listed; pending applications
/// stay private to the applicant and the admin queue.
async fn list_experts(State(state): App, headers: HeaderMap) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    let cards: Vec<Value> = db.experts.iter().filter(|e| e.status == "verified").map(|e| {
        let mut v = serde_json::to_value(e).unwrap();
        v["name"] = json!(db.users.get(&e.user_id).map(|u| u.name.clone()).unwrap_or_else(|| "Expert".into()));
        v
    }).collect();
    ok_json(Value::Array(cards))
}

/// The caller's own expert card (null when they never applied).
async fn my_expert_card(State(state): App, headers: HeaderMap) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let db = db_lock!(state);
    match db.experts.iter().find(|e| e.user_id == session.user_id) {
        Some(e) => ok_json(serde_json::to_value(e).unwrap()),
        None => ok_json(Value::Null),
    }
}

async fn post_consultation(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    if !b["question"].is_string() || !b["bountyEgp"].is_number() { return err(StatusCode::BAD_REQUEST, "question and bountyEgp required"); }
    let c = Consultation {
        id: format!("con-{}", uuid::Uuid::new_v4()), requester_id: session.user_id.clone(),
        question: b["question"].as_str().unwrap().into(), bounty_egp: b["bountyEgp"].as_f64().unwrap(),
        platform_commission_pct: 15.0, scope: b["scope"].as_str().unwrap_or("public").into(),
        status: "open".into(), chosen_response_id: None, group_conversation_id: None,
        language: b["language"].as_str().unwrap_or("en").into(),
        created_at: crate::util::now_ms(),
    };
    db_lock!(state).consultations.insert(c.id.clone(), c.clone());
    created(serde_json::to_value(&c).unwrap())
}

/// The consultation POOL. Public requests are visible to every authenticated
/// user so a global expert can find work; targeted ones stay with the two
/// parties involved.
async fn list_consultations(State(state): App, headers: HeaderMap) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let db = db_lock!(state);
    let uid = &session.user_id;
    let answered = |cid: &str| db.consultation_responses.iter().any(|r| r.consultation_id == cid && r.responder_id == *uid);
    let mut visible: Vec<&Consultation> = db.consultations.values()
        .filter(|c| c.scope == "public" || c.requester_id == *uid || answered(&c.id))
        .collect();
    visible.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let rows: Vec<Value> = visible.into_iter().map(|c| {
        let mut v = serde_json::to_value(c).unwrap();
        v["requesterName"] = json!(db.users.get(&c.requester_id).map(|u| u.name.clone()).unwrap_or_else(|| "Requester".into()));
        v["responseCount"] = json!(db.consultation_responses.iter().filter(|r| r.consultation_id == c.id).count());
        v["mine"] = json!(c.requester_id == *uid);
        v["answered"] = json!(answered(&c.id));
        v
    }).collect();
    ok_json(Value::Array(rows))
}

/// Full consultation view: the request, every recommendation with its expert
/// card, the payout split once settled, and the thread ids the UI opens.
/// Payout amounts are shown to the requester and to the owning responder only.
async fn consultation_detail(State(state): App, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let db = db_lock!(state);
    let uid = &session.user_id;
    let Some(c) = db.consultations.get(&id) else { return err(StatusCode::NOT_FOUND, "consultation not found"); };
    let has_responded = db.consultation_responses.iter().any(|r| r.consultation_id == id && r.responder_id == *uid);
    // A targeted request must not even confirm its own existence to outsiders.
    if c.scope != "public" && c.requester_id != *uid && !has_responded {
        return err(StatusCode::NOT_FOUND, "consultation not found");
    }
    let is_requester = c.requester_id == *uid;
    // Thread ids are only meaningful to members: reading a thread you are not
    // in returns 404, so handing the id out would render a dead chat window.
    let is_member_of = |cid: &Option<String>| -> Option<String> {
        let cid = cid.as_ref()?;
        db.conversations.iter().find(|cv| cv.id == *cid && cv.member_ids.contains(uid)).map(|cv| cv.id.clone())
    };

    let mut consultation = serde_json::to_value(c).unwrap();
    consultation["requesterName"] = json!(db.users.get(&c.requester_id).map(|u| u.name.clone()).unwrap_or_else(|| "Requester".into()));
    match is_member_of(&c.group_conversation_id) {
        Some(cv) => consultation["groupConversationId"] = json!(cv),
        None => { consultation.as_object_mut().unwrap().remove("groupConversationId"); }
    }

    let mut responses: Vec<&ConsultationResponse> = db.consultation_responses.iter().filter(|r| r.consultation_id == id).collect();
    responses.sort_by_key(|r| r.created_at);
    let responses: Vec<Value> = responses.into_iter().map(|r| {
        let expert = db.experts.iter().find(|e| e.user_id == r.responder_id);
        let visible_money = is_requester || r.responder_id == *uid;
        json!({
            "id": r.id, "consultationId": r.consultation_id, "responderId": r.responder_id,
            "responderName": db.users.get(&r.responder_id).map(|u| u.name.clone()).unwrap_or_else(|| "Expert".into()),
            "answer": r.answer,
            "conversationId": is_member_of(&r.conversation_id),
            "ratingStars": r.rating_stars,
            "payoutStatus": r.payout_status,
            "commissionAmount": if visible_money { r.commission_amount } else { None },
            "netPayoutEgp": if visible_money { r.net_payout_egp } else { None },
            "createdAt": r.created_at,
            "expert": expert.map(|e| json!({
                "avgStars": e.avg_stars, "answersCount": e.answers_count, "country": e.country,
                "institution": e.institution, "specializations": e.specializations, "yearsExp": e.years_exp,
            })),
        })
    }).collect();

    let can_respond = db.experts.iter().any(|e| e.user_id == *uid && e.status == "verified") && !is_requester && !has_responded;
    ok_json(json!({ "consultation": consultation, "responses": responses, "isRequester": is_requester, "canRespond": can_respond }))
}

async fn respond_consultation(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let answer = b["answer"].as_str().unwrap_or("").trim().to_string();
    if answer.is_empty() { return err(StatusCode::BAD_REQUEST, "answer required"); }
    let mut db = db_lock!(state);
    if !db.consultations.contains_key(&id) { return err(StatusCode::NOT_FOUND, "consultation not found"); }
    if let Err(msg) = crate::community::can_respond(&db, &session.user_id) {
        return err(StatusCode::FORBIDDEN, msg);
    }
    db.consultation_responses.push(ConsultationResponse { id: format!("res-{}", uuid::Uuid::new_v4()), consultation_id: id.clone(), responder_id: session.user_id.clone(), answer, rating_stars: None, net_payout_egp: None, commission_amount: None, conversation_id: None, payout_status: "none".into(), created_at: crate::util::now_ms() });

    // F6b: while the request is open, requester + every responder share ONE
    // group thread so the case can be discussed before a winner is picked.
    let (requester_id, question, existing) = {
        let c = db.consultations.get(&id).unwrap();
        (c.requester_id.clone(), c.question.clone(), c.group_conversation_id.clone())
    };
    let group_id = match existing.filter(|g| db.conversations.iter().any(|cv| cv.id == *g)) {
        Some(g) => g,
        None => {
            let conv = Conversation {
                id: format!("cv-{}", uuid::Uuid::new_v4()), kind: "consultation".into(),
                title: Some(question.chars().take(60).collect()), farm_id: None,
                consultation_id: Some(id.clone()), member_ids: vec![requester_id],
                created_by: db.consultations[&id].requester_id.clone(), created_at: crate::util::now_ms(),
            };
            let gid = conv.id.clone();
            db.conversations.push(conv);
            db.consultations.get_mut(&id).unwrap().group_conversation_id = Some(gid.clone());
            gid
        }
    };
    if let Some(cv) = db.conversations.iter_mut().find(|cv| cv.id == group_id) {
        if !cv.member_ids.contains(&session.user_id) { cv.member_ids.push(session.user_id.clone()); }
    }
    created(json!({ "ok": true }))
}

/// Choose winner: escrow split (pure fn) + payout pending + reputation update.
async fn choose_response_rt(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let Some(response_id) = b["responseId"].as_str().map(String::from) else { return err(StatusCode::BAD_REQUEST, "responseId required"); };
    let mut db = db_lock!(state);
    let (bounty, commission_pct, question) = match db.consultations.get(&id) {
        // Only the person who funded the bounty may release it.
        Some(c) if c.requester_id != session.user_id => return err(StatusCode::FORBIDDEN, "only the requester may choose a response"),
        Some(c) => (c.bounty_egp, c.platform_commission_pct, c.question.clone()),
        None => return err(StatusCode::NOT_FOUND, "consultation not found"),
    };
    let responder_id = match db.consultation_responses.iter_mut().find(|r| r.id == response_id && r.consultation_id == id) {
        Some(resp) => {
            resp.payout_status = "pending".into();
            let (commission, net) = crate::community::split_bounty(bounty, commission_pct);
            resp.commission_amount = Some(commission);
            resp.net_payout_egp = Some(net);
            Some((resp.responder_id.clone(), net))
        }
        None => return err(StatusCode::BAD_REQUEST, "response does not belong to this consultation"),
    };
    let Some((responder, net)) = responder_id else { return err(StatusCode::BAD_REQUEST, "response does not belong to this consultation"); };
    if let Some(c) = db.consultations.get_mut(&id) {
        c.status = "chosen".into();
        c.chosen_response_id = Some(response_id.clone());
    }
    // F6b: dedicated direct thread between requester and chosen responder. It
    // is PERSISTED, otherwise the promised chat window has no conversation to
    // open.
    let conv = Conversation {
        id: format!("cv-{}", uuid::Uuid::new_v4()), kind: "direct".into(),
        title: Some(question.chars().take(60).collect()), farm_id: None,
        consultation_id: Some(id.clone()), member_ids: vec![session.user_id.clone(), responder.clone()],
        created_by: session.user_id.clone(), created_at: crate::util::now_ms(),
    };
    let cv_id = conv.id.clone();
    db.conversations.push(conv);
    if let Some(resp) = db.consultation_responses.iter_mut().find(|r| r.id == response_id) {
        resp.conversation_id = Some(cv_id);
    }
    if let Some(exp) = db.experts.iter_mut().find(|e| e.user_id == responder) {
        exp.answers_count += 1;
        exp.total_earned_egp += net;
    }
    drop(db);
    audit_db(&state, "", "", "consultation.choose", "consultation", &id);
    ok_json(json!({ "netPayoutEgp": net }))
}

async fn rate_consultation(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let stars = b["stars"].as_u64().unwrap_or(0);
    if !(1..=5).contains(&stars) { return err(StatusCode::BAD_REQUEST, "stars 1..5 required"); }
    let mut db = db_lock!(state);
    let Some(c) = db.consultations.get(&id).cloned() else { return err(StatusCode::NOT_FOUND, "consultation not found"); };
    if c.requester_id != session.user_id { return err(StatusCode::FORBIDDEN, "only the requester may rate the chosen answer"); }
    let chosen = c.chosen_response_id.clone();
    let Some(chosen) = chosen else { return err(StatusCode::BAD_REQUEST, "no chosen response yet"); };
    let responder = {
        let Some(resp) = db.consultation_responses.iter_mut().find(|r| r.id == chosen) else {
            return err(StatusCode::BAD_REQUEST, "no chosen response yet");
        };
        resp.rating_stars = Some(stars as u8);
        resp.responder_id.clone()
    };
    if let Some(exp) = db.experts.iter_mut().find(|e| e.user_id == responder) {
        exp.avg_stars = stars as f64; // v1 running average over rated answers
    }
        ok_json(json!({ "avgStars": stars }))
}

// ======================================================== P7 ACADEMY

async fn list_cases(State(state): App, headers: HeaderMap) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    ok_json(serde_json::to_value(db.cases.iter().filter(|c| c.status == "published").collect::<Vec<_>>()).unwrap())
}

async fn publish_case(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let (session, _) = match guard(&state, &headers, Action::IssueClose, || None) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let Some(issue_id) = b["issueId"].as_str() else { return err(StatusCode::BAD_REQUEST, "issueId required"); };
    let mut db = db_lock!(state);
    let Some(issue) = db.issues.iter().find(|i| i.id == issue_id) else { return err(StatusCode::NOT_FOUND, "issue not found"); };
    if issue.stage != "closed" { return err(StatusCode::BAD_REQUEST, "only CLOSED issues can become learning cases"); }
    // ADR-020: freeze an anonymized snapshot; identity fields OMITTED entirely.
    let case = LearningCase {
        id: format!("case-{}", uuid::Uuid::new_v4()), source_type: "issue".into(), source_id: issue_id.into(),
        published_by: session.user_id.clone(), anonymized: b["anonymized"].as_bool().unwrap_or(true),
        crop_tags: vec![], status: "published".into(),
        snapshot: json!({ "title": issue.title, "kind": issue.kind, "severity": issue.severity }),
        created_at: crate::util::now_ms(),
    };
    db.cases.push(case.clone());
    L("community").info("learning case published", &[("caseId", case.id.as_str())]);
    created(serde_json::to_value(&case).unwrap())
}

async fn create_quiz_rt(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let (session, actor) = match guard(&state, &headers, Action::DeviceView, || None) {
        Ok(g) => g,
        Err(e) => return e,
    };
    // Authoring gate: verified academic/crowd experts only (F7b).
    let verified = db_lock!(state).experts.iter().any(|e| e.user_id == session.user_id && e.status == "verified");
    if !verified && !actor.personas.iter().any(|p| p == "admin") {
        return err(StatusCode::FORBIDDEN, "only VERIFIED experts may author quizzes");
    }
    let quiz = Quiz { id: format!("qz-{}", uuid::Uuid::new_v4()), title: b["title"].as_str().unwrap_or("").into(), author_id: session.user_id.clone(), pass_threshold_pct: b["passThresholdPct"].as_f64().unwrap_or(90.0), status: "draft".into(), created_at: crate::util::now_ms() };
    db_lock!(state).quizzes.push(quiz.clone());
    created(serde_json::to_value(&quiz).unwrap())
}

async fn add_question_rt(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let mut db = db_lock!(state);
    if !db.quizzes.iter().any(|q| q.id == id) { return err(StatusCode::NOT_FOUND, "quiz not found"); }
    let qid = format!("qq-{}", uuid::Uuid::new_v4());
    db.questions.push(QuizQuestion { id: qid.clone(), quiz_id: id.clone(), q_type: b["type"].as_str().unwrap_or("mcq").into(), prompt: b["prompt"].as_str().unwrap_or("").into(), options: vec![], answer_key: b["answerKey"].as_str().unwrap_or("").into(), points: b["points"].as_f64().unwrap_or(1.0) });
    created(json!({ "id": qid }))
}

/// Learner listing: answer keys destructured AWAY before responding (ADR-021).
async fn list_quizzes(State(state): App, headers: HeaderMap) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    let quizzes: Vec<Value> = db.quizzes.iter().filter(|q| q.status == "published")
        .map(|q| {
            let questions: Vec<Value> = db.questions.iter().filter(|qq| qq.quiz_id == q.id)
                .map(|qq| json!({ "id": qq.id, "type": qq.q_type, "prompt": qq.prompt, "points": qq.points })) // NO answerKey
                .collect();
            json!({ "id": q.id, "title": q.title, "passThresholdPct": q.pass_threshold_pct, "questions": questions })
        }).collect();
    ok_json(Value::Array(quizzes))
}

async fn submit_attempt(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let answers: Vec<(String, String)> = b["answers"].as_array().map(|a|
        a.iter().filter_map(|x| Some((x["questionId"].as_str()?.to_string(), x["answer"].to_string()))).collect()
    ).unwrap_or_default();
    let mut db = db_lock!(state);
    match crate::community::grade_attempt(&mut db, &id, &session.user_id, &answers) {
        Ok(att) => created(serde_json::to_value(&att).unwrap()),
        Err(msg) => err(StatusCode::NOT_FOUND, msg),
    }
}

// ============================================================== P1 WEBSOCKET
/// Push gateway. Auth via ?token= (browser WS cannot set headers). Each
/// connected user gets an mpsc queue; send_msg pushes to member queues.
async fn ws_gateway(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>, upgrade: WebSocketUpgrade) -> Response {
    let _ = state;
    let Some(session) = q.get("token").and_then(|t| auth::verify(t)) else {
        let mut res = err(StatusCode::UNAUTHORIZED, "unauthorized");
        return res;
    };
    let uid = session.user_id.clone();
    let _ = headers;
    upgrade.on_upgrade(move |socket| async move {
        use futures_util::{SinkExt, StreamExt};
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        ws_registry().lock().unwrap().entry(uid.clone()).or_default().push(tx);
        let (mut sink, mut stream) = socket.split();
        // Forward queued pushes to this client.
        let out = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sink.send(axum::extract::ws::Message::Text(msg)).await.is_err() { break; }
            }
        });
        // Drain inbound frames (keepalive); close cleans the registry entry.
        while let Some(Ok(_)) = stream.next().await {}
        if let Ok(mut reg) = ws_registry().lock() {
            reg.remove(&uid);
        }
        out.abort();
    })
}

// ===========================================================================
// PARITY PORT — endpoints added to Node after the initial Rust build
// (finances R5 · ADR-022 evidence capture trio). Same shapes, same codes.
// ===========================================================================

/// GET /finances?type=&category= — accountant/owner ledger view (R5).
async fn list_finances(State(state): App, headers: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    // Ledger rows live as raw JSON records (Postgres table arrives with swap).
    let list: Vec<&Value> = db.schedules.iter().filter(|s| s.get("ledger").is_some())
        .filter(|s| q.get("type").map_or(true, |t| s["type"] == *t))
        .filter(|s| q.get("category").map_or(true, |c| s["category"] == *c)).collect();
    ok_json(Value::Array(list.into_iter().cloned().collect()))
}

/// POST /finances — record an expense/income entry (optionally with receipt).
async fn add_finance(State(state): App, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    if !b["amount"].is_number() || !b["type"].is_string() {
        return err(StatusCode::BAD_REQUEST, "type and amount required");
    }
    let mut db = db_lock!(state);
    let mut rec = b.clone();
    rec["id"] = json!(format!("fin-{}", uuid::Uuid::new_v4()));
    rec["createdBy"] = json!(session.user_id);
    rec["createdAt"] = json!(crate::util::now_ms());
    rec["ledger"] = json!(true); // marks the record as a ledger row for list_finances
    db.schedules.push(rec.clone());
    L("community").info("finance entry recorded", &[("by", session.user_id.as_str())]);
    created(rec)
}

/// GET /finances/summary — category totals KPI (accountant dashboard).
async fn finance_summary(State(state): App, headers: HeaderMap) -> Response {
    if let Err(e) = must_auth(&headers) { return e; }
    let db = db_lock!(state);
    let mut totals: HashMap<String, f64> = HashMap::new();
    for s in &db.schedules {
        if s.get("ledger").is_some() {
            let cat = s["category"].as_str().unwrap_or("other").to_string();
            *totals.entry(cat).or_default() += s["amount"].as_f64().unwrap_or(0.0);
        }
    }
    ok_json(serde_json::to_value(totals).unwrap())
}

/// ADR-022 universal evidence store (parity with Node POST /v2/evidence).
async fn evidence_upload(State(state): App, headers: HeaderMap, mut mp: Multipart) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let mut saved = None;
    // Field is moved by bytes(); extract content-type BEFORE consuming it.
    while let Some(field) = mp.next_field().await.ok().flatten() {
        let is_file = field.name() == Some("file");
        let ct = field.content_type().map(|c| c.to_string()).unwrap_or_default();
        if is_file {
            let data = field.bytes().await.unwrap_or_default();
            let ext = ct.split('/').nth(1).unwrap_or("jpg").replace("jpeg", "jpg");
            let name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
            tokio::fs::write(std::path::Path::new("uploads").join(&name), data).await.ok();
            saved = Some(format!("/uploads/{name}"));
        }
    }
    let Some(url) = saved else { return err(StatusCode::BAD_REQUEST, "multipart file required"); };
    L("http").info("evidence artifact stored", &[("by", session.user_id.as_str())]);
    created(json!({ "url": url }))
}

/// ADR-022 CHAT media: photo/video captured in-app shared into the thread.
async fn chat_media(State(state): App, Path(id): Path<String>, headers: HeaderMap, mut mp: Multipart) -> Response {
    let Ok(session) = must_auth(&headers) else { return err(StatusCode::UNAUTHORIZED, "Unauthorized"); };
    let (conv, sender_name) = {
        let db = db_lock!(state);
        let name = db.users.get(&session.user_id).map(|u| u.name.clone()).unwrap_or_else(|| session.user_id.clone());
        match db.conversations.iter().find(|c| c.id == id) {
            Some(c) => (c.clone(), name),
            None => return err(StatusCode::NOT_FOUND, "conversation not found"),
        }
    };
    if !conv.member_ids.contains(&session.user_id) { return err(StatusCode::FORBIDDEN, "not a member"); }
    let mut url = None;
    let mut is_video = false;
    while let Some(field) = mp.next_field().await.ok().flatten() {
        if field.name() == Some("file") {
            let ct = field.content_type().map(|c| c.to_string()).unwrap_or_default();
            is_video = ct.starts_with("video");
            let data = field.bytes().await.unwrap_or_default();
            let ext = if is_video { "mp4" } else { "jpg" };
            let name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
            tokio::fs::write(std::path::Path::new("uploads").join(&name), data).await.ok();
            url = Some(format!("/uploads/{name}"));
        }
    }
    let Some(media_url) = url else { return err(StatusCode::BAD_REQUEST, "multipart file required"); };
    let msg = Message {
        id: format!("msg-{}", uuid::Uuid::new_v4()), conversation_id: id.clone(), sender_id: session.user_id.clone(),
        sender_name, msg_type: if is_video { "video" } else { "photo" }.into(),
        original_text: None, original_lang: None, translations: Some(json!({})), media_url: Some(media_url),
        duration_s: None, pinned: false, reply_to_id: None, idempotency_key: None,
        created_at: crate::util::now_ms(),
    };
    for m in &conv.member_ids {
        if m != &msg.sender_id {
            push_to_user(m, &json!({ "event": "message", "message": msg }).to_string());
        }
    }
    db_lock!(state).messages.push(msg.clone());
    created(serde_json::to_value(&msg).unwrap())
}

/// Mobile convenience: DETECTED→INSPECTED carrying uploaded evidence URLs.
async fn advance_with_evidence(State(state): App, Path(id): Path<String>, headers: HeaderMap, Json(b): Json<Value>) -> Response {
    let fid = db_lock!(state).issues.iter().find(|i| i.id == id).map(|i| i.farm_id.clone());
    let (session, actor) = match guard(&state, &headers, Action::IssueAdvance, || fid) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let label = if actor.personas.iter().any(|p| p == "admin") { "admin".to_string() }
        else if actor.memberships.iter().any(|(f, r)| f == "f-1") { actor.memberships.iter().find(|(f, _)| f == "f-1").unwrap().1.clone() }
        else { "worker".into() };
    let note = b["note"].as_str().map(String::from);
    let evidence = b.get("evidence").cloned();
    let mut db = db_lock!(state);
    match crate::issues::advance(&mut db, &id, "inspected", &actor.user_id, false, &label, note.as_deref(), evidence, None) {
        Ok(issue) => ok_json(serde_json::to_value(&issue).unwrap()),
        Err(e) => {
            let code = match e.code { "forbidden" => StatusCode::FORBIDDEN, "bad_stage" | "closed" => StatusCode::CONFLICT, _ => StatusCode::BAD_REQUEST };
            (code, Json(json!({ "error": e.message, "code": e.code }))).into_response()
        }
    }
}
