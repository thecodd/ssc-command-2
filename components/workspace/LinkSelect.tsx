import { fieldCls } from "@/components/ui/field";
import type { LinkRef } from "@/services/workspace";
const KIND: Record<string, string> = { ncert_chapter: "NCERT", ssc_topic: "SSC topic", ssc_subtopic: "SSC subtopic" };
/** Pick a learning item the user has started (or the one they came from). Value = "<type>:<id>". */
export function LinkSelect({ choices, preset, required = false, label = "Linked to" }: { choices: LinkRef[]; preset: LinkRef | null; required?: boolean; label?: string }) {
  const all = preset && !choices.some((c) => c.id === preset.id) ? [preset, ...choices] : choices;
  return (
    <label className="block text-sm text-sub">{label}{required ? "" : " (optional)"}
      <select name="link" required={required} defaultValue={preset ? `${preset.type}:${preset.id}` : ""} className={`${fieldCls} mt-1`}>
        <option value="">{required ? "Choose a chapter or topic" : "Not linked"}</option>
        {all.map((c) => <option key={c.type + c.id} value={`${c.type}:${c.id}`}>{KIND[c.type] ?? c.type} · {c.title}</option>)}
      </select>
    </label>
  );
}
