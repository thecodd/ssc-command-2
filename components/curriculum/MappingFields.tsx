import { fieldCls } from "@/components/ui/ActionForm";
import { MAPPING_LABEL, RELEVANCE_LABEL } from "@/lib/format";
export function MappingFields({ d }: { d?: { type: string; relevance: string; reason: string | null; recommended: boolean } }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-sub">Mapping type<select name="mapping_type" defaultValue={d?.type ?? "foundation"} className={`${fieldCls} mt-1 text-ink`}>{Object.entries(MAPPING_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block text-sm text-sub">Relevance<select name="relevance" defaultValue={d?.relevance ?? "medium"} className={`${fieldCls} mt-1 text-ink`}>{Object.entries(RELEVANCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <label className="block text-sm text-sub">Why it matters<textarea name="reason" rows={3} defaultValue={d?.reason ?? ""} className={`${fieldCls} mt-1 py-3 text-ink`} /></label>
      <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" name="recommended" defaultChecked={d?.recommended ?? true} className="h-5 w-5 accent-[#B8FF3D]" />Recommended</label>
    </>
  );
}
