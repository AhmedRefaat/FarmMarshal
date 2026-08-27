//! issues.rs — universal 7-stage workflow engine (G0.2)
//! ===========================================================================
//! EXACT mirror of `server-node/src/issues.ts`:
//!   detected → inspected → identified → recommended → implemented → reviewed → closed
//! Single forward steps only; per-stage persona + evidence gates; immutable
//! timeline events appended on every transition.
//!
//! STAGE ENTRY RULES (evidence table from V2_REQUIREMENTS_ANALYSIS §G0.2):
//!   inspected    → evidence required (photos/GPS)      [worker, moderator]
//!   identified   → note required (root cause)          [moderator]
//!   recommended  → note required (proposed solution)   [moderator]
//!   implemented  → existing taskId required            [worker, moderator]
//!   reviewed     → evidence required                   [moderator]
//!   closed       → note required                       [moderator, owner]

use crate::store::Db;
use crate::types::{Issue, IssueEvent};
use crate::util::now_ms;

#[derive(Debug)]
pub struct StageError {
    pub code: &'static str, // bad_stage | forbidden | missing_requirement | closed
    pub message: String,
}

/// Advance ONE stage with full guard evaluation (mirrors advanceIssue()).
/// `actor_role_label` = owner|membership role resolved by the route layer.
#[allow(clippy::too_many_arguments)]
pub fn advance(
    db: &mut Db,
    issue_id: &str,
    to_stage: &str,
    actor_id: &str,
    is_admin: bool,
    actor_role_label: &str,
    note: Option<&str>,
    evidence: Option<serde_json::Value>,
    task_id: Option<&str>,
) -> Result<Issue, StageError> {
    // ---- READ PHASE (immutable): validate everything BEFORE mutating ----
    let existing = db
        .issues
        .iter()
        .find(|i| i.id == issue_id)
        .ok_or_else(|| StageError { code: "bad_stage", message: format!("issue '{issue_id}' not found") })?
        .clone();

    if existing.stage == "closed" {
        return Err(StageError { code: "closed", message: "closed issues are immutable".into() });
    }
    let from_idx = crate::types::STAGES.iter().position(|s| *s == existing.stage).unwrap_or(0);
    let to_idx = match crate::types::STAGES.iter().position(|s| *s == to_stage) {
        Some(i) => i,
        None => return Err(StageError { code: "bad_stage", message: format!("no rule for stage '{to_stage}'") }),
    };
    if to_idx != from_idx + 1 {
        return Err(StageError {
            code: "bad_stage",
            message: format!("cannot advance from '{}' to '{to_stage}'", existing.stage),
        });
    }

    // Persona gate per target stage (admin bypasses).
    let allowed: &[&str] = match to_stage {
        "inspected" | "implemented" => &["worker", "moderator"],
        "identified" | "reviewed" | "recommended" => &["moderator"],
        "closed" => &["moderator", "owner"],
        _ => &[],
    };
    if !is_admin && !allowed.contains(&actor_role_label) {
        return Err(StageError {
            code: "forbidden",
            message: format!("'{actor_role_label}' cannot advance to '{to_stage}'"),
        });
    }

    // Evidence gates — exact parity with the Node rules table.
    match to_stage {
        "inspected" | "reviewed" => {
            let ok = evidence.as_ref().map(|e| !e.is_null()).unwrap_or(false);
            if !ok {
                return Err(StageError { code: "missing_requirement", message: format!("evidence is required to enter '{to_stage}'") });
            }
        }
        "identified" | "recommended" | "closed" => {
            if note.map(|n| n.trim().is_empty()).unwrap_or(true) {
                return Err(StageError { code: "missing_requirement", message: format!("a note is required to enter '{to_stage}'") });
            }
        }
        "implemented" => {
            let tid = task_id.ok_or_else(|| StageError {
                code: "missing_requirement",
                message: "a taskId is required to enter 'implemented'".into(),
            })?;
            if !db.tasks.contains_key(tid) {
                return Err(StageError { code: "missing_requirement", message: format!("task '{tid}' does not exist") });
            }
        }
        _ => {}
    }

    // ---- WRITE PHASE (mutable): id allocated before the borrow ----
    let event_id = db.next_id();
    let from_stage = existing.stage.clone();
    let issue = db.issues.iter_mut().find(|i| i.id == issue_id).unwrap();
    issue.stage = to_stage.to_string();
    if let Some(t) = task_id {
        issue.task_id = Some(t.to_string());
    }
    if to_stage == "closed" {
        issue.closed_at = Some(now_ms());
    }
    let event = IssueEvent {
        id: event_id,
        issue_id: issue_id.to_string(),
        from_stage,
        to_stage: to_stage.to_string(),
        actor_id: actor_id.into(),
        actor_role: actor_role_label.into(),
        note: note.map(String::from),
        evidence,
        at: now_ms(),
    };
    db.issue_events.push(event);
    Ok(issue.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authz;
    use crate::store;

    fn fresh_issue(db: &mut Db) -> String {
        let iid = db.next_id();
        db.issues.push(Issue {
            id: iid.clone(), farm_id: "f-1".into(), kind: "pest".into(), stage: "detected".into(),
            source: "human_report".into(), title: "t".into(), severity: "low".into(),
            task_id: None, created_by: "u-mod".into(), created_at: 0, closed_at: None, metadata: None,
        });
        let eid = db.next_id();
        db.issue_events.push(IssueEvent { id: eid, issue_id: iid.clone(), from_stage: "detected".into(), to_stage: "detected".into(), actor_id: "u-mod".into(), actor_role: "moderator".into(), note: None, evidence: None, at: 0 });
        iid
    }

    /// G0.2: worker may INSPECT with evidence; skipping stages rejected.
    #[test]
    fn worker_inspects_with_evidence_but_cannot_skip() {
        let mut db = store::seed();
        let id = fresh_issue(&mut db);
        // skip detected→identified → bad_stage
        let err = advance(&mut db, &id, "identified", "u-worker", false, "worker", Some("n"), None, None).err().expect("must fail");
        assert_eq!(err.code, "bad_stage");
        // missing evidence → missing_requirement
        let err = advance(&mut db, &id, "inspected", "u-worker", false, "worker", None, None, None).err().expect("must fail");
        assert_eq!(err.code, "missing_requirement");
        // with evidence → inspected
        let out = advance(&mut db, &id, "inspected", "u-worker", false, "worker", None, Some(serde_json::json!({"photo":"p"})), None).unwrap();
        assert_eq!(out.stage, "inspected");
    }

    /// G0.2 + ADR-009: implemented gate requires an EXISTING task.
    #[test]
    fn implemented_gate_requires_existing_task() {
        let mut db = store::seed();
        let id = fresh_issue(&mut db);
        advance(&mut db, &id, "inspected", "u-mod", false, "moderator", None, Some(json_e()), None).unwrap();
        advance(&mut db, &id, "identified", "u-mod", false, "moderator", Some("root cause"), None, None).unwrap();
        advance(&mut db, &id, "recommended", "u-mod", false, "moderator", Some("fix it"), None, None).unwrap();
        let err = advance(&mut db, &id, "implemented", "u-worker", false, "worker", None, None, Some("nope")).err().expect("must fail");
        assert_eq!(err.code, "missing_requirement"); // nonexistent task
        let ok = advance(&mut db, &id, "implemented", "u-worker", false, "worker", None, None, Some("t-2")).unwrap();
        assert_eq!(ok.stage, "implemented");
    }

    /// G0.2: closed issues are immutable (audit frozen).
    #[test]
    fn closed_issues_immutable() {
        let mut db = store::seed();
        let id = fresh_issue(&mut db);
        let ev = || serde_json::json!({"p":1});
        advance(&mut db, &id, "inspected", "u-mod", false, "moderator", None, Some(ev()), None).unwrap();
        advance(&mut db, &id, "identified", "u-mod", false, "moderator", Some("n"), None, None).unwrap();
        advance(&mut db, &id, "recommended", "u-mod", false, "moderator", Some("r"), None, None).unwrap();
        advance(&mut db, &id, "implemented", "u-worker", false, "worker", None, None, Some("t-2")).unwrap();
        advance(&mut db, &id, "reviewed", "u-mod", false, "moderator", None, Some(ev()), None).unwrap();
        advance(&mut db, &id, "closed", "u-mod", false, "moderator", Some("done"), None, None).unwrap();
        let err = advance(&mut db, &id, "reviewed", "u-mod", false, "moderator", None, Some(ev()), None).err().expect("must fail");
        assert_eq!(err.code, "closed");
    }

    fn json_e() -> serde_json::Value { serde_json::json!({"photo": "p"}) }
}
