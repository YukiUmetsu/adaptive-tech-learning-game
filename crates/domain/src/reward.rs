//! Bits reward policy.
//!
//! The reward invariant from `docs/07-gamification.md` is:
//!
//! ```text
//! first-attempt success >= recovery after failure > skip/reveal (0)
//! ```
//!
//! Incorrect attempts never subtract Bits, and a retried question cannot earn the
//! full first-attempt reward again.

/// Base Bits for a first-attempt, fully-correct answer.
pub const BASE_BITS: i64 = 10;

/// Difficulty bonus in `[0, 6]`, derived from the question's difficulty prior.
pub fn difficulty_bonus(difficulty_prior: f64) -> i64 {
    (difficulty_prior.clamp(0.0, 1.0) * 6.0).round() as i64
}

/// Bits earned for one accepted attempt.
///
/// A non-fully-correct attempt earns nothing. The first fully-correct attempt
/// earns the full reward; a later fully-correct attempt (recovery) earns roughly
/// half. Values are deterministic so they are easy to test and audit.
pub fn reward_bits(attempt_number: i32, score: f64, difficulty_prior: f64) -> i64 {
    if score < 1.0 {
        return 0;
    }
    let full = BASE_BITS + difficulty_bonus(difficulty_prior);
    if attempt_number <= 1 {
        full
    } else {
        (full / 2).max(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incorrect_attempts_earn_nothing() {
        assert_eq!(reward_bits(1, 0.0, 0.5), 0);
        assert_eq!(reward_bits(1, 0.99, 0.5), 0);
        assert_eq!(reward_bits(3, 0.5, 0.5), 0);
    }

    #[test]
    fn first_attempt_success_earns_full_reward() {
        assert_eq!(reward_bits(1, 1.0, 0.0), 10);
        assert_eq!(reward_bits(1, 1.0, 0.5), 13);
        assert_eq!(reward_bits(1, 1.0, 1.0), 16);
    }

    #[test]
    fn recovery_earns_less_than_first_attempt() {
        let first = reward_bits(1, 1.0, 0.6);
        let recovery = reward_bits(2, 1.0, 0.6);
        assert!(recovery > 0, "recovery must still be rewarded");
        assert!(recovery < first, "recovery must be less than first attempt");
        assert_eq!(recovery, (first / 2).max(1));
    }
}
