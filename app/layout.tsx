import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "@/components/shell/RegisterSW";
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const metadata: Metadata = { title: "CGL Command", description: "Your complete SSC CGL preparation system", manifest: "/manifest.json", appleWebApp: { capable: true, title: "CGL Command", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { themeColor: "#09090B", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={inter.variable}><body className="font-sans antialiased">{children}<RegisterSW /></body></html>;
}
