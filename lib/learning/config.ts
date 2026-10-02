// MIRROR of the SQL lc_* functions in migration 005 (the database is authoritative). database/tests/reference/run_reference_tests.js
// fails if any value here differs from SQL. The app uses these only for presentation (heartbeat interval, display).
export const LEARNING = {
  // Mastery
  minAttemptsForAccuracy: 5,     // below this many PYQ attempts, accuracy is "unknown", never "weak"
  recentWindow: 10,              // accuracy is computed over the newest N attempts (done in SQL; documented here)
  weakAccuracy: 50,              // recent accuracy below this (with enough attempts) => weak
  strongAccuracy: 75,
  masteredAccuracy: 80,
  weakConfidence: 2,             // self-rated 1-5
  strongConfidence: 4,
  hardStreakForWeak: 2,          // this many consecutive "hard" reviews => weak
  // Revision ladder
  defaultIntervals: [1, 3, 7, 15, 30] as readonly number[],
  maxIntervals: 12,
  maxIntervalDays: 365,
  stepOnGood: 1,
  stepOnEasy: 2,
  stepOnHard: -1,                // hard also resets the next gap to the shortest interval
  // Study sessions
  heartbeatSeconds: 30,
  staleSessionSeconds: 600,      // no heartbeat for 10 min => session is abandoned
  staleCreditSeconds: 90,        // an abandoned session is credited up to last heartbeat + this grace
  minCountedSessionSeconds: 30,  // shorter sessions don't count toward the session counter
  maxSessionSeconds: 21600,      // a session never credits more than 6 h; paused sessions untouched this long are abandoned
  // Daily focus
  focusMaxItems: 5,
} as const;
