// Which failed browser requests are EXPECTED during real-route validation, and which are defects. Pure; unit-tested in tests/kit/ci.test.mjs.
//
// Expected (ignored, but still logged):
//  1. "rsc-abort": a GET for a Next.js React Server Component payload (`?_rsc=` / `&_rsc=` in the URL) that fails with net::ERR_ABORTED.
//     Next's <Link> prefetches these in the background and the router cancels them whenever the page navigates, unmounts or the context closes; the
//     document itself and every link target are checked separately (status codes, link scan), so nothing real is hidden.
//  2. "action-abort-on-navigation": a same-origin POST server action (header `next-action`) that fails with net::ERR_ABORTED AND was started before the
//     page's main frame began a later navigation, or while the harness was closing the page. The browser cancels in-flight requests of a document it
//     leaves; the server-side effect is checked by the flows themselves.
// Everything else is a defect: any other ERR_ABORTED, any non-abort network error (refused, reset, DNS, CORS/ERR_FAILED, timeout), any request to
// another origin, and any HTTP 4xx/5xx response (responses are not "failed requests" and are handled elsewhere: never filtered here).
export function classifyFailure({ method, url, errorText, headers = {}, base, startedAt, failedAt, lastNavigationAt = null, closing = false }) {
  const aborted = /^net::ERR_ABORTED$/.test(String(errorText || "").trim());
  let u; try { u = new URL(url); } catch { return { kind: "unexpected", reason: "unparsable URL" }; }
  const sameOrigin = base ? u.origin === new URL(base).origin : true;
  if (!sameOrigin) return { kind: "unexpected", reason: "cross-origin request failed" };
  if (!aborted) return { kind: "unexpected", reason: `network error ${errorText}` };
  if (String(method).toUpperCase() === "GET" && u.searchParams.has("_rsc")) return { kind: "expected", reason: "rsc-abort" };
  const isAction = String(method).toUpperCase() === "POST" && Object.keys(headers).some((h) => h.toLowerCase() === "next-action");
  if (isAction) {
    if (closing) return { kind: "expected", reason: "action-abort-on-close" };
    if (lastNavigationAt !== null && startedAt !== undefined && startedAt <= lastNavigationAt && failedAt >= lastNavigationAt) return { kind: "expected", reason: "action-abort-on-navigation" };
    return { kind: "unexpected", reason: "server action aborted without a navigation or close that explains it" };
  }
  return { kind: "unexpected", reason: "ERR_ABORTED on a request that is neither an RSC payload nor a server action" };
}
/** Attaches the bookkeeping classifyFailure needs to a Playwright page. Returns { isClosing(), setClosing(), onUnexpected(fn), expected[] }. */
export function trackFailures(page, base, onUnexpected, onExpected = () => {}) {
  const started = new Map(); let lastNavigationAt = null, closing = false;
  page.on("request", (r) => { started.set(r, Date.now()); if (r.isNavigationRequest() && r.frame() === page.mainFrame()) lastNavigationAt = Date.now(); });
  page.on("requestfailed", (r) => {
    if (/favicon|_next\/static|\.map$/.test(r.url())) return;
    const c = classifyFailure({ method: r.method(), url: r.url(), errorText: r.failure()?.errorText, headers: r.headers(), base, startedAt: started.get(r), failedAt: Date.now(), lastNavigationAt, closing });
    const line = `${r.method()} ${r.url().slice(0, 160)} ${r.failure()?.errorText} [${c.reason}]`;
    (c.kind === "expected" ? onExpected : onUnexpected)(line);
  });
  return { setClosing: () => { closing = true; } };
}
