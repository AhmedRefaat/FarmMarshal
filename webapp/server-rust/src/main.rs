//! main.rs — COMPOSITION ROOT (Trail-1: Rust + Axum)
//! ===========================================================================
//! EXACT behavioural mirror of `server-node/src/index.ts`:
//! same routes, same JSON contract, same seed fixtures, same logging control
//! model (LOG_LEVEL / LOG_FORMAT — see logger.rs), listening on :8080
//! (Node runs :3000; clients switch by changing ONE base URL).
//!
//! MODULE MAP (component separation requested by the owner):
//!   types.rs      — wire-contract structs (mirror of types.ts)
//!   store.rs      — in-memory repository + seed (mirror of store.ts; ADR-004 seam)
//!   auth.rs       — HMAC token issue/verify (mirror of auth.ts)
//!   authz.rs      — permission matrix + persona union (mirror of authz.ts)
//!   issues.rs     — universal 7-stage workflow engine (mirror of issues.ts)
//!   agri.rs       — water/solar/trees pure domain fns (mirror of agri.ts)
//!   community.rs  — marketplace/academy pure domain fns (mirror of community.ts)
//!   logger.rs     — dev/customer/off logging control (mirror of logger.ts)
//!   util.rs       — shared time helper
//!   routes/mod.rs — legacy core handlers (auth/users/tasks/comments/ratings)
//!   routes/v2core.rs   — P0 surface (issues/personas/plans/audit)  [include!]
//!   routes/features.rs — P1–P7 surface + WS gateway                [include!]
//!
//! REQUIREMENT TRACEABILITY
//! ------------------------
//!   - docs/TECH_COMPARISON_STUDY.md §C: Rust = hot-path/specialized trail;
//!     identical REST contract so any client can run against either server.
//!   - docs/ARCHITECTURE_EVOLUTION_PLAN.md §2 "Rust section" for full details.

mod agri;
mod auth;
mod authz;
mod chat_domain_marker {} // placeholder module name reserved; chat logic lives in routes
mod community;
mod issues;
mod logger;
mod routes;
mod security;
mod store;
mod types;
mod util;

use axum::{routing::get, Router};
use std::sync::{Arc, Mutex};
use tower_http::{
    cors::CorsLayer,
    services::ServeDir,
};

/// Shared application state: the whole DB behind a Mutex + nothing else.
/// Handlers hold the lock only across synchronous sections (never .await),
/// mirroring Node's single-threaded mutation semantics.
#[derive(Clone)]
pub struct DbState {
    pub db: Arc<Mutex<store::Db>>,
}

#[tokio::main]
async fn main() {
    // 1. Logging first so every subsequent line honours LOG_LEVEL/LOG_FORMAT.
    logger::init_from_env();

    // 2. SEC-C01: resolve the signing key BEFORE anything can serve traffic.
    //    Panics on a missing, placeholder or weak secret outside development,
    //    so a misconfigured process fails at boot instead of issuing tokens
    //    anyone can forge. Only provenance and length are logged.
    let (secret_source, secret_len) = auth::describe_secret();
    let boot = logger::make_logger("boot");
    boot.info(
        "auth signing configuration",
        &[
            ("source", secret_source),
            ("env", security::current_env().as_str()),
            ("length", secret_len.to_string().as_str()),
        ],
    );

    // 3. Persisted uploads directory (audio comments, evidence photos).
    std::fs::create_dir_all("uploads").ok();

    // 4. Seed once at boot — fixture parity with the Node trail is REQUIRED
    //    because both trails must serve identical demo data and pass the
    //    identical test expectations (leak fixture, dusty panel, tree cases).
    let state = DbState { db: Arc::new(Mutex::new(store::seed())) };

    let app = routes::router(state.clone())
        .layer(CorsLayer::permissive()) // dev parity: Node uses origin:true
        // Static /uploads/* so <audio src>/<Image source> resolve directly.
        .fallback_service(ServeDir::new("uploads"));

    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
    let log = logger::make_logger("http");
    log.info("server starting", &[("port", port.to_string().as_str()), ("trail", "rust")]);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}
