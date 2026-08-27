//! auth.rs — stateless HMAC token authentication
//! ===========================================================================
//! BYTE-COMPATIBLE with `server-node/src/auth.ts`:
//!   token = base64url(JSON{userId,role,exp}) "." base64url(HMAC-SHA256(payload))
//! A client can authenticate against EITHER server with the SAME token format.
//!
//! REQUIREMENT TRACEABILITY
//! ------------------------
//!   - docs/TECH_COMPARISON_STUDY.md §C (stateless HMAC; JWT swap seam noted)
//!   - docs/V2_REQUIREMENTS_ANALYSIS.md §G0.1b (persona union resolved in authz)

use crate::types::Session;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::sync::OnceLock;

/// Process-wide signing key, resolved exactly once.
static SECRET: OnceLock<String> = OnceLock::new();

/// Resolve and cache the signing secret.
///
/// SEC-C01: this used to be `env::var("AUTH_SECRET").unwrap_or_else(|_| <literal>)`,
/// so any instance started without the variable signed tokens with a key
/// published in this repository. Resolution now fails closed outside
/// development and there is no usable literal left to fall back to.
///
/// # Panics
/// Deliberately, on invalid configuration. A process that cannot sign safely
/// must not serve traffic; `init()` surfaces this at boot rather than on the
/// first request.
pub fn init() -> &'static str {
    SECRET.get_or_init(|| {
        let env = crate::security::current_env();
        match crate::security::resolve_auth_secret(env.as_str(), std::env::var("AUTH_SECRET").ok().as_deref()) {
            Ok(value) => value,
            // The message describes the defect; it never contains the value.
            Err(e) => panic!("refusing to start: {e}"),
        }
    })
}

/// Signing secret (parity: AUTH_SECRET). Never logged, never returned to a caller.
pub fn secret() -> &'static str {
    init()
}

/// Boot-time description of the signing configuration: provenance and validity
/// only, mirroring `describeAuthSecret()`. The value never appears here.
pub fn describe_secret() -> (&'static str, usize) {
    let source = if std::env::var("AUTH_SECRET").map(|v| !v.trim().is_empty()).unwrap_or(false) {
        "environment"
    } else {
        "ephemeral-development"
    };
    (source, secret().len())
}

/// 7-day TTL, matching Node exactly.
const TTL_MS: u64 = 7 * 24 * 3600 * 1000;

fn mac() -> Hmac<Sha256> {
    Hmac::<Sha256>::new_from_slice(secret().as_bytes()).expect("hmac key")
}

fn sign(payload: &str) -> String {
    let mut m = mac();
    m.update(payload.as_bytes());
    B64.encode(m.finalize().into_bytes())
}

/// Issue a signed token for a user (mirrors issueToken()).
pub fn issue_token(user_id: &str, role: &str) -> String {
    let payload = serde_json::json!({ "userId": user_id, "role": role, "exp": crate::util::now_ms() + TTL_MS });
    let p = B64.encode(serde_json::to_string(&payload).unwrap());
    format!("{p}.{}", sign(&p))
}

/// Verify a Bearer value → Session.
///
/// The signature is checked with `Mac::verify_slice`, which compares in
/// constant time. The previous implementation used `sign(payload) != sig` on
/// `String`, which short-circuits on the first differing byte — the doc comment
/// claimed constant-time comparison that the code did not perform.
pub fn verify(token: &str) -> Option<Session> {
    let (payload, sig) = token.split_once('.')?;
    let expected = B64.decode(sig).ok()?;
    let mut m = mac();
    m.update(payload.as_bytes());
    m.verify_slice(&expected).ok()?;
    let json = B64.decode(payload).ok()?;
    let session: Session = serde_json::from_slice(&json).ok()?;
    if session.exp < crate::util::now_ms() {
        return None; // expired
    }
    Some(session)
}

#[cfg(test)]
mod tests {
    use crate::security::{resolve_auth_secret, SecretError, INSECURE_LEGACY_SECRET};

    #[test]
    fn production_refuses_missing_secret() {
        assert_eq!(
            resolve_auth_secret("production", None),
            Err(SecretError::Missing)
        );
        assert_eq!(
            resolve_auth_secret("production", Some("   ")),
            Err(SecretError::Missing)
        );
    }

    #[test]
    fn every_environment_refuses_the_published_literal() {
        for env in ["production", "staging", "development", "test"] {
            assert_eq!(
                resolve_auth_secret(env, Some(INSECURE_LEGACY_SECRET)),
                Err(SecretError::Placeholder),
                "env {env} accepted the published literal"
            );
        }
    }

    #[test]
    fn refuses_short_and_trivially_weak_secrets() {
        assert_eq!(
            resolve_auth_secret("production", Some("tooshort")),
            Err(SecretError::TooShort)
        );
        assert_eq!(
            resolve_auth_secret("production", Some(&"ab".repeat(20))),
            Err(SecretError::TriviallyWeak)
        );
    }

    #[test]
    fn accepts_a_strong_operator_supplied_secret() {
        let strong = "K7q2Zx9Lm4Rt8Wn3Yb6Vc1Hd5Jf0Gp2Sa";
        assert_eq!(
            resolve_auth_secret("production", Some(strong)),
            Ok(strong.to_string())
        );
    }

    #[test]
    fn development_mints_a_random_key_not_the_literal() {
        let first = resolve_auth_secret("development", None).unwrap();
        let second = resolve_auth_secret("development", None).unwrap();
        assert_ne!(first, INSECURE_LEGACY_SECRET);
        assert_ne!(first, second, "each resolution must be independently random");
        assert!(first.len() >= 32);
    }

    /// A token signed with the burned literal must not verify once the process
    /// is running on a rotated key.
    #[test]
    fn legacy_signed_tokens_do_not_verify() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
        use hmac::{Hmac, Mac};
        use sha2::Sha256;

        let payload = B64.encode(r#"{"userId":"u-admin","role":"admin","exp":99999999999999}"#);
        let mut m = Hmac::<Sha256>::new_from_slice(INSECURE_LEGACY_SECRET.as_bytes()).unwrap();
        m.update(payload.as_bytes());
        let forged = format!("{payload}.{}", B64.encode(m.finalize().into_bytes()));

        assert!(super::verify(&forged).is_none());
    }
}
