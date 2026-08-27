//! security.rs — password hashing, role validation and security configuration
//! for the Rust trail.
//!
//! Mirrors `webapp/server-node/src/security/{passwords,roles,config}.ts` so both
//! backends enforce identical rules. Fixes:
//!   * GAP-01 / SEC-C1 — `POST /auth/register` took `role` straight from the
//!     request body and inserted it, so `{"role":"admin"}` created a platform
//!     administrator without any authentication.
//!   * SEC-C3 — `db.passwords` held plaintext and login was a string compare.
//!   * SEC-C01 — `auth::secret()` fell back to a literal committed to this
//!     repository, so anyone able to read the source could mint an admin token
//!     against any instance where AUTH_SECRET was unset.

use password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use rand_core::OsRng;
use scrypt::Scrypt;

// ---------------------------------------------------------------------------
// Signing configuration (parity with security/config.ts)
// ---------------------------------------------------------------------------

/// The value that shipped in source before this fix. Retained ONLY as a
/// deny-list entry — it is never returned as a usable secret. Every token ever
/// signed with it must be treated as forged.
pub const INSECURE_LEGACY_SECRET: &str = "agritasks-dev-secret";

/// Values that are syntactically fine but are never a deliberate choice.
pub const PLACEHOLDER_SECRETS: [&str; 9] = [
    INSECURE_LEGACY_SECRET,
    "changeme",
    "change-me",
    "secret",
    "password",
    "todo",
    "placeholder",
    "your-secret-here",
    "xxxxxxxx",
];

/// Minimum accepted length for an operator-supplied secret, in characters.
pub const MIN_AUTH_SECRET_LENGTH: usize = 32;

const DEV_ENVIRONMENTS: [&str; 2] = ["development", "test"];

/// Why a signing configuration was refused. The offending value is never
/// carried in the error so it cannot reach a log.
#[derive(Debug, PartialEq, Eq)]
pub enum SecretError {
    Missing,
    Placeholder,
    TooShort,
    TriviallyWeak,
}

impl std::fmt::Display for SecretError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let msg = match self {
            SecretError::Missing => "AUTH_SECRET must be set in a non-development environment",
            SecretError::Placeholder => {
                "AUTH_SECRET is a placeholder value and must be replaced with a generated secret"
            }
            SecretError::TooShort => "AUTH_SECRET must be at least 32 characters",
            SecretError::TriviallyWeak => {
                "AUTH_SECRET is trivially weak; use a randomly generated value"
            }
        };
        f.write_str(msg)
    }
}

pub fn is_dev_like_env(env: &str) -> bool {
    DEV_ENVIRONMENTS.contains(&env)
}

/// Environment name, mirroring Node's `NODE_ENV` default of `development`.
pub fn current_env() -> String {
    std::env::var("APP_ENV")
        .or_else(|_| std::env::var("NODE_ENV"))
        .unwrap_or_else(|_| "development".to_string())
}

fn is_placeholder(raw: &str) -> bool {
    let normalised = raw.trim().to_ascii_lowercase();
    PLACEHOLDER_SECRETS.iter().any(|p| normalised == *p)
}

/// How many distinct characters the value uses — a cheap proxy for entropy.
fn looks_trivially_weak(raw: &str) -> bool {
    let mut seen: Vec<char> = raw.chars().collect();
    seen.sort_unstable();
    seen.dedup();
    seen.len() < 8
}

/// Random per-process development key. Two UUIDv4 values give 244 bits of
/// entropy from the OS RNG and require no extra dependency.
pub fn generate_ephemeral_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Resolve the token signing secret, mirroring `resolveAuthSecret()` exactly.
///
/// A supplied value is validated in EVERY environment; only the consequence of
/// omitting it differs — development mints a random key, anything else refuses.
pub fn resolve_auth_secret(env: &str, raw: Option<&str>) -> Result<String, SecretError> {
    match raw.map(str::trim).filter(|v| !v.is_empty()) {
        None => {
            if is_dev_like_env(env) {
                Ok(generate_ephemeral_secret())
            } else {
                Err(SecretError::Missing)
            }
        }
        Some(_) => {
            let value = raw.unwrap();
            if is_placeholder(value) {
                return Err(SecretError::Placeholder);
            }
            if value.chars().count() < MIN_AUTH_SECRET_LENGTH {
                return Err(SecretError::TooShort);
            }
            if looks_trivially_weak(value) {
                return Err(SecretError::TriviallyWeak);
            }
            Ok(value.to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/// Every role the platform recognises.
pub const ALL_ROLES: [&str; 4] = ["owner", "moderator", "worker", "admin"];

/// The only role a caller may self-assign through public registration.
pub const DEFAULT_REGISTRATION_ROLE: &str = "worker";

/// Roles that confer authority over other users or other tenants.
pub const PRIVILEGED_ROLES: [&str; 3] = ["admin", "owner", "moderator"];

pub fn is_known_role(role: &str) -> bool {
    ALL_ROLES.contains(&role)
}

pub fn is_privileged_role(role: &str) -> bool {
    PRIVILEGED_ROLES.contains(&role)
}

/// Outcome of validating a role supplied by an unauthenticated caller.
pub enum RoleDecision {
    /// Safe to use.
    Allow(String),
    /// Value is not a role the platform knows — client error.
    Unknown,
    /// Value is a real role but may not be self-assigned — authorization error.
    Forbidden,
}

/// Decide the role for a public registration request.
///
/// `None` (field omitted) yields the safe default rather than an error, so a
/// well-behaved client need not send the field at all.
pub fn resolve_public_registration_role(requested: Option<&str>) -> RoleDecision {
    match requested {
        None | Some("") => RoleDecision::Allow(DEFAULT_REGISTRATION_ROLE.to_string()),
        Some(role) if !is_known_role(role) => RoleDecision::Unknown,
        Some(role) if is_privileged_role(role) => RoleDecision::Forbidden,
        Some(role) => RoleDecision::Allow(role.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

pub const PASSWORD_MIN_LENGTH: usize = 10;
pub const PASSWORD_MAX_LENGTH: usize = 1024;

/// Reject weak or abusive passwords before hashing.
/// Returns `None` when acceptable, otherwise a caller-safe reason.
pub fn validate_password_policy(plain: &str) -> Option<&'static str> {
    if plain.len() < PASSWORD_MIN_LENGTH {
        return Some("password must be at least 10 characters");
    }
    if plain.len() > PASSWORD_MAX_LENGTH {
        return Some("password must be at most 1024 characters");
    }
    if !plain.chars().any(|c| c.is_ascii_alphabetic()) || !plain.chars().any(|c| c.is_ascii_digit())
    {
        return Some("password must contain at least one letter and one digit");
    }
    None
}

/// Derive a PHC-formatted scrypt hash (`$scrypt$...`) with a random salt.
///
/// # Panics
/// Never on valid input; a hashing failure returns an `Err` instead.
pub fn hash_password(plain: &str) -> Result<String, password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Scrypt.hash_password(plain.as_bytes(), &salt)?.to_string())
}

/// Constant-time verification. Returns `false` for any malformed stored value
/// so a corrupted record cannot become an authentication bypass or a panic.
pub fn verify_password(plain: &str, stored: &str) -> bool {
    match PasswordHash::new(stored) {
        Ok(parsed) => Scrypt.verify_password(plain.as_bytes(), &parsed).is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_registration_never_grants_privilege() {
        assert!(matches!(
            resolve_public_registration_role(None),
            RoleDecision::Allow(ref r) if r == "worker"
        ));
        assert!(matches!(
            resolve_public_registration_role(Some("worker")),
            RoleDecision::Allow(ref r) if r == "worker"
        ));
        for role in ["admin", "owner", "moderator"] {
            assert!(matches!(
                resolve_public_registration_role(Some(role)),
                RoleDecision::Forbidden
            ));
        }
        assert!(matches!(
            resolve_public_registration_role(Some("superuser")),
            RoleDecision::Unknown
        ));
    }

    #[test]
    fn password_round_trip() {
        let hash = hash_password("Str0ngPassphrase").unwrap();
        assert!(hash.starts_with("$scrypt$"));
        assert!(!hash.contains("Str0ngPassphrase"));
        assert!(verify_password("Str0ngPassphrase", &hash));
        assert!(!verify_password("wrong", &hash));
    }

    #[test]
    fn distinct_salt_per_hash() {
        let a = hash_password("Str0ngPassphrase").unwrap();
        let b = hash_password("Str0ngPassphrase").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn malformed_stored_values_are_rejected() {
        for stored in ["", "plaintext", "$scrypt$broken", "pass123"] {
            assert!(!verify_password("Str0ngPassphrase", stored));
        }
    }

    #[test]
    fn password_policy_boundaries() {
        assert!(validate_password_policy("short1").is_some());
        assert!(validate_password_policy("alllettersonly").is_some());
        assert!(validate_password_policy("1234567890").is_some());
        assert!(validate_password_policy("Str0ngPassphrase").is_none());
    }
}
