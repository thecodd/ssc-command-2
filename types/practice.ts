// Practice contracts (Phase 4 RPCs + 012). Everything about correctness comes FROM the server: the browser never holds an answer key.
export type PracticeScope = "ssc_topic" | "ssc_subtopic" | "ssc_subject" | "weak" | "mixed";
export type Difficulty = "easy" | "medium" | "hard";
export interface PracticeAnsweredRow { pyq_id: string; selected: string; is_correct: boolean; time_taken_seconds: number | null }
export interface PracticeSession {
  id: string; scope_type: PracticeScope; scope_id: string | null; state: "active" | "completed" | "abandoned";
  pyq_ids: string[]; total: number; started_at: string; ended_at: string | null; answered: PracticeAnsweredRow[];
}
export interface PracticeAnswer { selected: string; is_correct: boolean; correct_answer: string; explanation: string | null; time_taken_seconds: number | null }
export interface PracticeQuestion {
  pyq_id: string; position: number; total: number; session_state: "active" | "completed" | "abandoned";
  question: string; options: Record<string, string>; source_ref: string | null; difficulty: Difficulty | null;
  exam: string | null; year: number | null; tier: string | null; shift: string | null;
  /** null until the caller has answered THIS question in THIS session */
  answer: PracticeAnswer | null;
  /** only present after answering */
  topics: { id: string; title: string }[] | null;
  foundation: { id: string; title: string; topic_id: string } | null;
}
export interface SubmitResult { is_correct: boolean; selected: string; correct_answer: string; explanation: string | null; duplicate: boolean; answered: number; total: number }
export interface PracticeSummary {
  session_id: string; state: "completed" | "abandoned"; scope_type: PracticeScope; scope_id: string | null;
  planned: number; attempted: number; correct: number; incorrect: number; skipped: number; accuracy: number | null; total_seconds: number; avg_seconds: number | null;
  weak_topics: { topic_id: string; title: string; weak_reason: string | null; recent_accuracy: number | null }[];
}
export interface PracticeOptions { total: number; by_difficulty: Partial<Record<Difficulty, number>>; papers: { id: string; exam: string; year: number; tier: string | null; shift: string | null; n: number }[] }
export interface StartRequest { scope: PracticeScope; scopeId: string | null; count: number; difficulty: Difficulty | null; paper: string | null }
