import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
// Liveness probe for the host / load balancer. Public on purpose (the proxy lets it through) and deliberately touches no data.
export function GET() { return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } }); }
