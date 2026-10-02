import { NextResponse } from "next/server";
import { dbConfigured, getUser } from "@/lib/auth";
import { searchAll } from "@/services/search";
export const dynamic = "force-dynamic";
const H = { "Cache-Control": "no-store" };
export async function GET(req: Request) {
  if (!dbConfigured()) return NextResponse.json({ error: "Not configured" }, { status: 503, headers: H });
  try {
    const { user } = await getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: H }); // also enforced here in case the middleware matcher changes
    return NextResponse.json({ hits: await searchAll(new URL(req.url).searchParams.get("q") ?? "") }, { headers: H });
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500, headers: H });
  }
}
