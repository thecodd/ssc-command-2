const tones = { lime: "border-lime/40 bg-lime-dim text-lime", violet: "border-violet/40 bg-violet/10 text-violet", mute: "border-line text-sub" };
export function Badge({ tone = "mute", children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}
export const relevanceTone = (r?: string) => (r === "very_high" || r === "high" ? "lime" : r === "medium" ? "violet" : "mute") as keyof typeof tones;
export const statusTone = (s?: string) => (s === "completed" ? "lime" : s === "learning" || s === "revision" ? "violet" : "mute") as keyof typeof tones;
