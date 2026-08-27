//! authz.rs — single permission choke point (G0.1 / G0.1b / ADR-017)
//! ===========================================================================
//! EXACT mirror of `server-node/src/authz.ts` semantics:
//!   • permissions = UNION of all ACTIVE personas (multi-persona model)
//!   • farm scoping via ownership + memberships
//!   • admin bypass — BUT unknown actions still FAIL CLOSED
//!   • `valve.control` is moderator+ ONLY (physical actuation rule, ADR-017)
//!
//! REQUIREMENT TRACEABILITY: V2_REQUIREMENTS_ANALYSIS §G0.1/§G0.1b,
//! READINESS_REVIEW §3 guarantee #1, IMPLEMENTATION_PLAN test matrix.

use crate::store::Db;
use crate::types::Persona;

/// Everything the decision function needs about one caller.
pub struct ActorContext {
    pub user_id: String,
    pub personas: Vec<Persona>,
    pub owned_farm_ids: Vec<String>,
    /// (farmId, roleInFarm) pairs for non-owner memberships.
    pub memberships: Vec<(String, String)>,
}

/// Actions protected by the matrix. Keep in lockstep with authz.ts!
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Action {
    IssueView,
    IssueCreate,
    IssueAdvance,
    IssueClose,
    DeviceView,
    ValveControl,
    PlanManage,
    SubscriptionAssign,
    PersonaVerify,
    AuditView,
    FlagManage,
}

/// Resolve the full context for a user (personas ∪ farms).
pub fn build_actor_context(db: &Db, user_id: &str) -> Option<ActorContext> {
    if !db.users.contains_key(user_id) {
        return None;
    }
    let mut personas: Vec<Persona> = Vec::new();
    // Primary role counts as a persona row too.
    if let Some(u) = db.users.get(user_id) {
        personas.push(u.role.clone());
    }
    for p in &db.personas {
        if p.user_id == user_id && p.status == "active" && !personas.contains(&p.persona) {
            personas.push(p.persona.clone());
        }
    }
    let mut owned = Vec::new();
    let mut memberships = Vec::new();
    for m in &db.farm_members {
        if m.user_id == user_id {
            if m.role_in_farm == "owner" {
                owned.push(m.farm_id.clone());
            } else {
                memberships.push((m.farm_id.clone(), m.role_in_farm.clone()));
            }
        }
    }
    Some(ActorContext { user_id: user_id.into(), personas, owned_farm_ids: owned, memberships })
}

fn belongs_to_farm(ctx: &ActorContext, farm_id: Option<&str>) -> bool {
    match farm_id {
        None => false, // missing farm scope → DENY (fail closed)
        Some(f) => ctx.owned_farm_ids.iter().any(|x| x == f) || ctx.memberships.iter().any(|(x, _)| x == f),
    }
}

fn member_with_role(ctx: &ActorContext, farm_id: Option<&str>, roles: &[&str]) -> bool {
    match farm_id {
        None => false,
        Some(f) => ctx.memberships.iter().any(|(x, r)| x == f && roles.contains(&r.as_str())),
    }
}

/// THE decision function. Unknown actions cannot be expressed in this enum,
/// which structurally guarantees fail-closed behaviour (mirrors KNOWN_ACTIONS).
pub fn can(ctx: &ActorContext, action: Action, farm_id: Option<&str>) -> bool {
    let admin = ctx.personas.iter().any(|p| p == "admin");
    if std::env::var("AUTHZ_DEBUG").is_ok() {
        println!("[authz-debug] action={:?} farm={:?} personas={:?} owned={:?} members={:?}", action, farm_id, ctx.personas, ctx.owned_farm_ids, ctx.memberships);
    }
    match action {
        Action::IssueView => admin || belongs_to_farm(ctx, farm_id),
        Action::IssueCreate | Action::IssueAdvance => {
            admin
                || member_with_role(ctx, farm_id, &["worker", "moderator"])
                || ctx.owned_farm_ids.iter().any(|x| Some(x.as_str()) == farm_id)
        }
        Action::IssueClose => {
            admin
                || member_with_role(ctx, farm_id, &["moderator"])
                || ctx.owned_farm_ids.iter().any(|x| Some(x.as_str()) == farm_id)
        }
        // ADR-017: physical actuation = moderator+ only, NEVER workers.
        Action::ValveControl => {
            admin
                || member_with_role(ctx, farm_id, &["moderator"])
                || ctx.owned_farm_ids.iter().any(|x| Some(x.as_str()) == farm_id)
        }
        // Authenticated read; per-item tenancy enforced handler-side via has_farm_access.
        Action::DeviceView => !ctx.personas.is_empty(),
        // Platform administration: admin-only by definition.
        Action::PlanManage | Action::SubscriptionAssign | Action::PersonaVerify
        | Action::AuditView | Action::FlagManage => admin,
    }
}

/// Handler-side tenancy assertion mirroring hasFarmAccess() in Node:
/// item-level reads check THIS instead of trusting list-level guards.
pub fn has_farm_access(ctx: &ActorContext, farm_id: Option<&str>) -> bool {
    belongs_to_farm(ctx, farm_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store;

    #[test]
    fn worker_can_advance_issue_on_own_farm() {
        let db = store::seed();
        let ctx = build_actor_context(&db, "u-worker").unwrap();
        println!("personas={:?} members={:?} owned={:?}", ctx.personas, ctx.memberships, ctx.owned_farm_ids);
        assert!(can(&ctx, Action::IssueAdvance, Some("f-1")), "worker must advance issues on own farm");
    }
}
