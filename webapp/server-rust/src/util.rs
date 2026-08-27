//! util.rs — small shared helpers (time, base64url token crypto seam).

/// Current time in epoch milliseconds — the canonical timestamp unit across
/// both server trails (Node uses Date.now(); identical semantics).
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
