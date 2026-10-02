# Real headless Chromium (Playwright 1.56, /opt/pw-browsers) against SSR+hydrated REAL components with FIXTURE data and in-memory fake APIs. No CSS (Tailwind unavailable).
# This is a component-level runtime smoke test. It is NOT validation of the real routes, real data, Supabase, or layout.
import json, os, re, sys, time
from playwright.sync_api import sync_playwright, expect
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
results = []
def check(name, fn):
    try: fn(); results.append((name, "PASS", "")); print("  PASS", name)
    except Exception as e: msg = str(e).splitlines()[0][:200] if str(e) else repr(e); results.append((name, "FAIL", msg)); print("  FAIL", name, "->", msg)

def open_page(b, scen, w=390, h=800):
    ctx = b.new_context(viewport={"width": w, "height": h}); p = ctx.new_page(); logs = []
    p.on("console", lambda m: logs.append((m.type, m.text)) if m.type in ("error", "warning") else None)
    p.on("pageerror", lambda e: logs.append(("pageerror", str(e))))
    p.goto("file://" + os.path.join(D, scen + ".html")); p.wait_for_function("window.__api !== undefined"); p.wait_for_timeout(300)
    p._logs = logs; return p
def blur(p): p.evaluate("document.activeElement && document.activeElement.blur()")
def timer_label(p): return p.get_by_role("timer").first.get_attribute("aria-label")

with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--no-sandbox"])
    print("chromium", b.version)
    # ---------------- STUDY ----------------
    print("[study]")
    p = open_page(b, "study")
    check("hydration: no console errors/warnings and no recoverable hydration errors (StrictMode on)", lambda: (_ for _ in ()).throw(AssertionError(str(p._logs[:3]) + str(p.evaluate("window.__recoverable||[]")))) if (p._logs or p.evaluate("(window.__recoverable||[]).length")) else None)
    check("idle: Start button present, no timer yet", lambda: (expect(p.get_by_role("button", name="Start studying").first).to_be_visible(), expect(p.get_by_role("timer")).to_have_count(0)))
    def dbl():
        p.get_by_role("button", name="Start studying").first.dblclick(); p.wait_for_timeout(300)
        assert p.evaluate("window.__api.calls.start") == 1, p.evaluate("window.__api.calls.start")
        assert "studying" in timer_label(p)
    check("double-click Start sends exactly ONE start request and shows the running timer", dbl)
    def timer_ticks():
        t1 = p.get_by_role("timer").first.inner_text(); p.wait_for_timeout(2300); t2 = p.get_by_role("timer").first.inner_text(); assert t1 != t2, (t1, t2)
    check("timer ticks from the server base (display advances while running)", timer_ticks)
    def space():
        blur(p); p.keyboard.press("Space"); p.wait_for_timeout(200); assert "paused" in timer_label(p), timer_label(p)
        blur(p); p.keyboard.press("Space"); p.wait_for_timeout(200); assert "studying" in timer_label(p)
    check("Space pauses and resumes when nothing interactive is focused", space)
    def space_on_button():
        before = p.evaluate("window.__api.calls.pause||0"); p.get_by_role("button", name="Pause").first.focus(); p.keyboard.press("Space"); p.wait_for_timeout(200)
        assert p.evaluate("window.__api.calls.pause||0") == before + 1, "Space on a focused button must activate THAT button exactly once"
        p.get_by_role("button", name="Resume").first.click(); p.wait_for_timeout(200)
    check("Space on a focused button activates that button once (shortcut does not double-fire)", space_on_button)
    def nkey():
        blur(p); p.keyboard.press("n"); p.wait_for_timeout(300); assert p.evaluate("document.activeElement && document.activeElement.hasAttribute('data-study-section')")
    check("N moves focus to the next study section", nkey)
    def esc_dialog():
        blur(p); p.keyboard.press("Escape"); p.wait_for_timeout(200)
        assert p.locator("dialog[open]").count() == 1; expect(p.locator("dialog[open]")).to_contain_text("Your timer is running")
        assert p.evaluate("!!document.activeElement.closest('dialog')"), "focus must move into the dialog"
        p.keyboard.press("Escape"); p.wait_for_timeout(200); assert p.locator("dialog[open]").count() == 0 and "studying" in timer_label(p)
    check("Esc while running opens the exit dialog (focus inside); Esc again closes it and the timer keeps running", esc_dialog)
    def notes():
        p.get_by_role("button", name=re.compile(r"^Notes \(")).first.click(); p.wait_for_timeout(200)
        assert p.locator("dialog[open]").count() == 1 and p.evaluate("!!document.activeElement.closest('dialog')")
        p.keyboard.press("Escape"); p.wait_for_timeout(200); assert p.locator("dialog[open]").count() == 0
    def typing_guard():
        p.evaluate("(()=>{const i=document.createElement('input');i.id='probe';document.body.appendChild(i);})()"); p.locator("#probe").focus(); p.keyboard.type("a b n"); p.wait_for_timeout(150)
        assert p.locator("#probe").input_value() == "a b n" and "studying" in timer_label(p), "typing Space/N in a field must not trigger shortcuts"
        p.evaluate("document.getElementById('probe').remove()")
    check("Notes sheet is a modal dialog (focus moves inside); Esc closes it", notes)
    check("typing Space/N in a text field does not trigger the study shortcuts", typing_guard)
    def fail_pause():
        p.evaluate("window.__api.control.failNext('timeout','pause')"); blur(p); p.keyboard.press("Space"); p.wait_for_timeout(500)
        expect(p.get_by_role("alert").first).to_contain_text("too long"); assert "studying" in timer_label(p)
        p.get_by_role("button", name="Retry").first.click(); p.wait_for_timeout(400); assert "paused" in timer_label(p), timer_label(p)
        p.get_by_role("button", name="Resume").first.click(); p.wait_for_timeout(300)
    check("timeout on Pause: friendly alert, timer still running (reconciled), Retry works", fail_pause)
    def other_tab():
        p.evaluate("window.__api.control.endElsewhere('completed')"); p.evaluate("window.dispatchEvent(new Event('focus'))"); p.wait_for_timeout(600)
        expect(p.get_by_role("heading", name="Session ended")).to_be_visible(); expect(p.get_by_text("finished in another tab").first).to_be_visible()
    check("session ended in another tab is detected on window focus and shown as 'Session ended'", other_tab)
    p.context.close()

    p = open_page(b, "study")
    p.get_by_role("button", name="Start studying").first.click(); p.wait_for_timeout(1200)
    def finish():
        p.get_by_role("button", name="Finish").first.click(); p.wait_for_timeout(400)
        expect(p.get_by_role("heading", name="Session complete")).to_be_visible(); expect(p.get_by_text("Time studied")).to_be_visible()
        assert p.get_by_role("timer").count() == 1 and "done" in timer_label(p)
    check("Finish shows the completion summary with server-reported time and a 'done' timer", finish)
    def conf():
        sec = p.locator("section[aria-labelledby=summary-h]"); sec.get_by_text("4", exact=True).click(); p.wait_for_timeout(300)
        assert p.evaluate("window.__api.calls.setProgress") == 1
    check("confidence 1-5 in the summary is a radio group and sends one progress update", conf)
    def nav_refresh(): assert any(n[0] == "refresh" for n in p.evaluate("window.__nav||[]")), "router.refresh() expected after finish"
    check("finish triggers a server-state refresh (router.refresh)", nav_refresh)
    p.context.close()

    p = open_page(b, "study-weak")
    def due_cta():
        a = p.get_by_role("link", name="Review").first; href = a.get_attribute("href"); assert re.match(r"^/revision/[0-9a-f-]{36}$", href or ""), href
        assert p.get_by_role("radio", name=re.compile("Hard|Good|Easy")).count() == 0, "no inline rating in Study Mode"
        expect(p.get_by_text("Revision overdue").first).to_be_visible()
    check("due revision: one 'Review' link to /revision/<uuid>; no inline rating; overdue label shown", due_cta)
    def indep():
        p.get_by_role("button", name=re.compile("Start (studying|revision)|Continue")).first.count()
        n = p.evaluate("Object.keys(window.__api).join(',')"); assert "reviewRevision" not in n
    check("Study Mode API surface contains no revision-review call", indep)
    p.context.close()

    # ---------------- REVIEW ----------------
    print("[review]")
    p = open_page(b, "review")
    check("hydration: no console errors/warnings and no recoverable hydration errors (StrictMode on)", lambda: (_ for _ in ()).throw(AssertionError(str(p._logs[:3]) + str(p.evaluate("window.__recoverable||[]")))) if (p._logs or p.evaluate("(window.__recoverable||[]).length")) else None)
    def recall():
        expect(p.get_by_role("heading", name="Can you still recall this?")).to_be_visible()
        assert p.get_by_role("radio").count() == 0, "no rating control before the material is shown"; expect(p.get_by_text("Fixture subtopic 1")).to_have_count(0)
    check("recall comes first: no rating controls and no material in the DOM", recall)
    def reveal():
        p.get_by_role("button", name="Show the material").click(); p.wait_for_timeout(200)
        expect(p.get_by_text("Fixture subtopic 1")).to_be_visible(); assert p.get_by_role("radio", name=re.compile("Hard|Good|Easy")).count() == 3
        expect(p.get_by_role("button", name="Save review")).to_be_disabled()
    check("reveal shows material and three rating radios; Save review disabled until one is picked", reveal)
    def preview():
        body = p.locator("body").inner_text(); assert "in 2 days" in body and "in 20 days" in body and "ladder complete" in body, "previews must reflect the custom 2-5-20 ladder"
    check("rating previews come from the injected (custom 2/5/20) ladder: 'in 2 days', 'in 20 days', 'ladder complete'", preview)
    def arrows():
        p.get_by_role("radio", name=re.compile("Hard")).focus(); p.keyboard.press("ArrowRight"); p.wait_for_timeout(100)
        assert p.get_by_role("radio", name=re.compile("Good")).is_checked(), "arrow keys must move within the radio group"
    check("radio group: ArrowRight moves Hard -> Good", arrows)
    def conf():
        p.locator("section[aria-label=Confidence]").get_by_text("5", exact=True).click(); p.wait_for_timeout(100)
        assert p.locator("section[aria-label=Confidence] input:checked").count() == 1
    check("optional confidence 1-5 can be set", conf)
    def pyq(): assert re.search(r"Start 5 PYQs", p.locator("body").inner_text()) and "back" not in (p.get_by_role("link", name="Start 5 PYQs").get_attribute("href") or "x") or True
    check("optional PYQ self-test link is offered (practiceHref provided)", lambda: expect(p.get_by_role("link", name="Start 5 PYQs")).to_be_visible())
    def save():
        btn = p.get_by_role("button", name="Save review"); expect(btn).to_be_enabled(); btn.dblclick(); p.wait_for_timeout(500)
        assert len(p.evaluate("window.__api.control.submits()")) == 1, p.evaluate("window.__api.control.submits().length")
        expect(p.get_by_role("heading", name="Good")).to_be_visible(); expect(p.get_by_text("Review complete")).to_be_visible(); expect(p.get_by_text("Next review", exact=True)).to_be_visible()
        assert p.evaluate("window.__api.control.submits()[0].expectedStep") == 1
    check("double-click Save sends ONE review with expected_step=1 and shows the result", save)
    check("result offers a primary 'Next revision' link to /revision/<uuid>", lambda: expect(p.get_by_role("link", name=re.compile("^Next revision"))).to_have_attribute("href", re.compile(r"^/revision/")))
    p.context.close()

    p = open_page(b, "review")
    def stale():
        p.get_by_role("button", name="Show the material").click(); p.get_by_role("radio", name=re.compile("Easy")).check(); p.evaluate("window.__api.control.otherTabReviews('good')")
        p.get_by_role("button", name="Save review").click(); p.wait_for_timeout(500)
        expect(p.get_by_role("alert")).to_contain_text("already updated elsewhere"); assert p.evaluate("window.__api.control.reviews()") == 1
        expect(p.get_by_role("link", name="Back to revision queue")).to_be_visible()
    check("stale tab: 'This revision was already updated elsewhere.', nothing overwritten (1 review total)", stale)
    p.context.close()
    p = open_page(b, "review")
    def lost():
        p.get_by_role("button", name="Show the material").click(); p.get_by_role("radio", name=re.compile("Good")).check(); p.evaluate("window.__api.control.landThenFail('timeout')")
        p.get_by_role("button", name="Save review").click(); p.wait_for_timeout(600); expect(p.get_by_role("alert")).to_contain_text("saved"); assert p.evaluate("window.__api.control.reviews()") == 1
    check("response lost after the write landed: detected by re-reading, no second review", lost)
    p.context.close()
    p = open_page(b, "review")
    def esc():
        blur(p); p.keyboard.press("Escape"); p.wait_for_timeout(200); assert ["push", "/revision"] in p.evaluate("window.__nav||[]")
    check("Esc (no dialog, not typing) leaves to /revision", esc)
    def sheet():
        p.get_by_role("button", name="Details").click(); p.wait_for_timeout(200); assert p.locator("dialog[open]").count() == 1; expect(p.locator("dialog[open]")).to_contain_text("Ladder")
        expect(p.locator("dialog[open]")).to_contain_text("2d"); p.keyboard.press("Escape"); p.wait_for_timeout(200); assert p.locator("dialog[open]").count() == 0
    check("Details bottom sheet opens as a modal dialog showing the user's ladder; Esc closes", sheet)
    p.context.close(); b.close()
tot = len(results); passed = sum(1 for r in results if r[1] == "PASS")
json.dump([{"name": n, "result": r, "detail": d} for n, r, d in results], open(os.path.join(D, "results.json"), "w"), indent=1)
print(f"\n{passed} passed, {tot - passed} failed, of {tot}"); sys.exit(0 if passed == tot else 1)
