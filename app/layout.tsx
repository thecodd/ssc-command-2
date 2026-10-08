import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "@/components/shell/RegisterSW";
// Every page is rendered per request: the Content-Security-Policy nonce (middleware.ts) only exists at request time, and no page may be a shared static copy.
export const dynamic = "force-dynamic";
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const metadata: Metadata = { title: "CGL Command", description: "Your complete SSC CGL preparation system", manifest: "/manifest.json", appleWebApp: { capable: true, title: "CGL Command", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#09090B", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={inter.variable}><body className="font-sans antialiased">{children}<RegisterSW /></body></html>;
}
