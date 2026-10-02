/** @type {import('next').NextConfig} */
// "page.dev.tsx" files are ONLY routable outside production. In a production build the extension is not registered, so Next never
// compiles, bundles or routes them (app/(focus)/dev/study-preview/page.dev.tsx is the only importer of tests/fixtures).
const dev = process.env.NODE_ENV !== "production";
export default { reactStrictMode: true, pageExtensions: dev ? ["tsx", "ts", "dev.tsx"] : ["tsx", "ts"] };
