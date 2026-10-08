/** @type {import('next').NextConfig} */
// "page.dev.tsx" files are ONLY routable outside production. In a production build the extension is not registered, so Next never
// compiles, bundles or routes them (app/(focus)/dev/study-preview/page.dev.tsx is the only importer of tests/fixtures).
const dev = process.env.NODE_ENV !== "production";
// Static security headers for every response (the per-request, nonce-based Content-Security-Policy is set in middleware.ts).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }, // ignored by browsers on plain http (local development, CI)
];
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: dev ? ["tsx", "ts", "dev.tsx"] : ["tsx", "ts"],
  // The curriculum import accepts files up to 5 MB (app/actions/import.ts); Next's default server action body limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() { return [{ source: "/:path*", headers: securityHeaders }]; },
};
