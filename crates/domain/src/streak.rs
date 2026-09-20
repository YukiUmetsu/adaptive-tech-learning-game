//! Account-wide daily study streak derivation.
//!
//! The streak spans **all** learning tracks: studying AWS today and Python
//! tomorrow continues the same streak. It is motivational, not learning
//! evidence, and never feeds concept state, scoring, or rewards.
//!
//! Persistence stores one row per `(user, local_day)` and the streak is derived
//! from those unique days, so retries and duplicate syncs cannot advance it
//! twice. The local day boundary comes from the learner's persisted IANA
//! timezone, matching Daily Mission behavior.

use std::collections::BTreeSet;

use chrono::{Days, NaiveDate};
use serde::{Deserialize, Serialize};

/// A derived account-wide streak.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreakSummary {
    /// Consecutive active days ending today or yesterday. `0` when the streak is
    /// broken (last active day is older than yesterday).
    pub current: u32,
    /// Longest consecutive run ever recorded.
    pub longest: u32,
    /// Whether the learner already qualified a study day today.
    pub active_today: bool,
    /// Most recent qualified study day, when any.
    pub last_active_day: Option<NaiveDate>,
}

impl StreakSummary {
    /// The neutral streak shown when there is no activity or data is unavailable.
    pub const fn empty() -> Self {
        Self {
            current: 0,
            longest: 0,
            active_today: false,
            last_active_day: None,
        }
    }
}

/// Derives the streak summary from unique active local days.
///
/// The result is deterministic and independent of insertion order. A streak is
/// still "current" while today is pending as long as the most recent active day
/// is today or yesterday; once the learner misses a full day it resets to zero.
pub fn summarize_streak(
    days: impl IntoIterator<Item = NaiveDate>,
    today: NaiveDate,
) -> StreakSummary {
    let days: BTreeSet<NaiveDate> = days.into_iter().filter(|day| *day <= today).collect();
    if days.is_empty() {
        return StreakSummary::empty();
    }

    let last_active_day = days.iter().next_back().copied();
    let active_today = last_active_day == Some(today);

    // Count consecutive days back from the most recent active day, but only if
    // that day is today or yesterday. Otherwise the streak has lapsed.
    let mut current = 0u32;
    if let Some(last) = last_active_day {
        let yesterday = today.checked_sub_days(Days::new(1));
        if last == today || Some(last) == yesterday {
            let mut expected = last;
            for day in days.iter().rev() {
                if *day == expected {
                    current += 1;
                    match expected.checked_sub_days(Days::new(1)) {
                        Some(previous) => expected = previous,
                        None => break,
                    }
                } else {
                    break;
                }
            }
        }
    }

    // Longest run over the whole history.
    let mut longest = 0u32;
    let mut run = 0u32;
    let mut previous: Option<NaiveDate> = None;
    for day in &days {
        run = match previous {
            Some(previous) if Some(*day) == previous.checked_add_days(Days::new(1)) => run + 1,
            _ => 1,
        };
        longest = longest.max(run);
        previous = Some(*day);
    }

    StreakSummary {
        current,
        longest,
        active_today,
        last_active_day,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("valid date")
    }

    #[test]
    fn empty_history_is_a_neutral_streak() {
        assert_eq!(
            summarize_streak(Vec::new(), day("2026-09-20")),
            StreakSummary::empty()
        );
    }

    #[test]
    fn active_today_alone_is_a_one_day_streak() {
        let summary = summarize_streak([day("2026-09-20")], day("2026-09-20"));
        assert_eq!(summary.current, 1);
        assert_eq!(summary.longest, 1);
        assert!(summary.active_today);
        assert_eq!(summary.last_active_day, Some(day("2026-09-20")));
    }

    #[test]
    fn consecutive_days_accumulate() {
        let summary = summarize_streak(
            [day("2026-09-18"), day("2026-09-19"), day("2026-09-20")],
            day("2026-09-20"),
        );
        assert_eq!(summary.current, 3);
        assert_eq!(summary.longest, 3);
        assert!(summary.active_today);
    }

    #[test]
    fn today_pending_still_keeps_yesterdays_streak() {
        let summary = summarize_streak([day("2026-09-18"), day("2026-09-19")], day("2026-09-20"));
        assert_eq!(summary.current, 2);
        assert!(!summary.active_today);
        assert_eq!(summary.last_active_day, Some(day("2026-09-19")));
    }

    #[test]
    fn a_skipped_day_resets_the_current_streak() {
        let summary = summarize_streak(
            [day("2026-09-10"), day("2026-09-11"), day("2026-09-12")],
            day("2026-09-20"),
        );
        assert_eq!(summary.current, 0);
        assert_eq!(summary.longest, 3);
        assert!(!summary.active_today);
    }

    #[test]
    fn duplicate_days_do_not_advance_the_streak() {
        let summary = summarize_streak(
            [day("2026-09-20"), day("2026-09-20"), day("2026-09-20")],
            day("2026-09-20"),
        );
        assert_eq!(summary.current, 1);
        assert_eq!(summary.longest, 1);
    }

    #[test]
    fn longest_tracks_the_best_run_not_the_current_one() {
        let summary = summarize_streak(
            [
                day("2026-09-01"),
                day("2026-09-02"),
                day("2026-09-03"),
                day("2026-09-04"),
                day("2026-09-19"),
                day("2026-09-20"),
            ],
            day("2026-09-20"),
        );
        assert_eq!(summary.current, 2);
        assert_eq!(summary.longest, 4);
    }

    #[test]
    fn future_days_are_ignored() {
        let summary = summarize_streak([day("2026-09-20"), day("2026-09-25")], day("2026-09-20"));
        assert_eq!(summary.current, 1);
        assert_eq!(summary.last_active_day, Some(day("2026-09-20")));
    }
}
