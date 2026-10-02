"use client";
import { Sheet } from "@/components/ui/Sheet";
import { useStudy } from "./StudyProvider";
/** Shown only when leaving while the timer is running. Honest about what happens to the time. */
export function ExitDialog() {
  const { exitOpen, setExitOpen, pauseAndLeave, leave, finish, state } = useStudy();
  const busy = state.busy !== null;
  return (
    <Sheet open={exitOpen} onClose={() => setExitOpen(false)} title="Your timer is running">
      <p className="text-sm text-sub">Pause it to keep your place. If you leave without pausing, the server only counts time up to your last sync, and the session closes itself after about 10 minutes of silence.</p>
      <div className="mt-4 grid gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={pauseAndLeave}>Pause and leave</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => { setExitOpen(false); finish(); }}>Finish session</button>
        <button type="button" className="btn-ghost" onClick={leave}>Leave without pausing</button>
        <button type="button" className="btn-ghost" onClick={() => setExitOpen(false)}>Stay here</button>
      </div>
    </Sheet>
  );
}
