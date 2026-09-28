import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    // Log to stderr so it shows up in server stdout
    console.error("[DEBUG ERROR]", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[DEBUG ERROR] parse failed", e);
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, msg: "debug endpoint active" });
}
