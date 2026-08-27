//! logger.rs — CROSS-CUTTING: application logging with mode + level control
//! ===========================================================================
//! EXACT behavioural mirror of `server-node/src/logger.ts` (docs/LOGGING_GUIDE.md).
//!
//! OWNER REQUIREMENT (why this exists)
//! -----------------------------------
//!  1. SEE the app's logs while running.
//!  2. ENABLE/DISABLE logging overall.
//!  3. Separate CUSTOMER logging (production, machine-parseable) from DEV
//!     logging (verbose, human-readable).
//!
//! CONTROL MODEL — two environment variables, read once at boot:
//!   LOG_LEVEL  = off | error | warn | info | debug   (default: info)
//!                'off' disables ALL output.
//!   LOG_FORMAT = dev | json                          (default: dev)
//!                dev  → coloured terminal lines
//!                json → one machine-parseable object per line for collectors
//!
//! DESIGN RULES
//! ------------
//! - Logging NEVER panics and never blocks business logic (writes are wrapped;
//!   a broken stdout must not fail an HTTP request).
//! - Audit ≠ logging: the append-only audit trail lives in the Db regardless
//!   of log level. Logs are ephemeral diagnostics; audit is compliance evidence.
//!
//! REQUIREMENT TRACEABILITY
//! ------------------------
//!   - Owner review "enable/disable logs, customer vs dev logging"
//!   - docs/LOGGING_GUIDE.md · docs/ARCHITECTURE_EVOLUTION_PLAN.md §6

use std::sync::atomic::{AtomicU8, Ordering};

/// Ordered severities; OFF sits below everything so nothing prints.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Off = 0,
    Error = 1,
    Warn = 2,
    Info = 3,
    Debug = 4,
}

impl Level {
    fn from_env() -> Level {
        match std::env::var("LOG_LEVEL").unwrap_or_default().to_lowercase().as_str() {
            "off" => Level::Off,
            "error" => Level::Error,
            "warn" => Level::Warn,
            "debug" => Level::Debug,
            _ => Level::Info,
        }
    }
    fn as_str(&self) -> &'static str {
        match self { Level::Off => "off", Level::Error => "error", Level::Warn => "warn", Level::Info => "info", Level::Debug => "debug" }
    }
}

/// Global gate — atomic so any thread can check without locking.
static CURRENT_LEVEL: AtomicU8 = AtomicU8::new(3); // info
static JSON_FORMAT: AtomicU8 = AtomicU8::new(0); // 0 = dev, 1 = json

/// Read env config once at boot; also prints the boot banner (when enabled).
pub fn init_from_env() {
    let level = Level::from_env();
    CURRENT_LEVEL.store(level as u8, Ordering::Relaxed);
    let format = std::env::var("LOG_FORMAT").unwrap_or_default().to_lowercase();
    JSON_FORMAT.store(if format == "json" { 1 } else { 0 }, Ordering::Relaxed);
    make_logger("boot").info(
        "logging configured",
        &[("level", level.as_str()), ("format", if format == "json" { "json" } else { "dev" })],
    );
}

fn enabled(level: Level) -> bool {
    (level as u8) <= CURRENT_LEVEL.load(Ordering::Relaxed) && CURRENT_LEVEL.load(Ordering::Relaxed) != 0
}

/// ISO-8601 UTC timestamp without external crates (seconds precision is fine
/// for logs; collectors add their own ingestion timestamps anyway).
fn timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    // Civil-from-days algorithm (Howard Hinnant) — no chrono dependency needed.
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// A scoped logger — one instance per module keeps output greppable:
/// `grep '"scope":"authz"'` finds every permission decision in production.
pub struct Logger {
    scope: &'static str,
}

pub fn make_logger(scope: &'static str) -> Logger {
    Logger { scope }
}

impl Logger {
    pub fn error(&self, msg: &str, meta: &[(&str, &str)]) { self.emit(Level::Error, msg, meta); }
    pub fn warn(&self, msg: &str, meta: &[(&str, &str)]) { self.emit(Level::Warn, msg, meta); }
    pub fn info(&self, msg: &str, meta: &[(&str, &str)]) { self.emit(Level::Info, msg, meta); }
    pub fn debug(&self, msg: &str, meta: &[(&str, &str)]) { self.emit(Level::Debug, msg, meta); }

    fn emit(&self, level: Level, msg: &str, meta: &[(&str, &str)]) {
        if !enabled(level) {
            return; // Gate: global kill-switch / level filter.
        }
        let line = if JSON_FORMAT.load(Ordering::Relaxed) == 1 {
            // Customer/production format: stable keys for log queries & alerts.
            let mut obj = format!("{{\"ts\":\"{}\",\"level\":\"{}\",\"scope\":\"{}\",\"msg\":\"{}\"", timestamp(), level.as_str(), self.scope, msg);
            for (k, v) in meta {
                obj.push_str(&format!(",\"{k}\":\"{v}\""));
            }
            obj.push('}');
            obj
        } else {
            // Developer format: readable, scoped (colours omitted for portability
            // across Windows consoles that may not honour ANSI by default).
            let mut s = format!("[{}] {} [{}] {}", timestamp(), level.as_str().to_uppercase(), self.scope, msg);
            for (k, v) in meta {
                s.push_str(&format!(" {k}={v}"));
            }
            s
        };
        // Never panic on stdout failure — logging must never crash the app.
        println!("{line}");
    }
}
