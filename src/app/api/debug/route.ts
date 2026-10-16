import { NextRequest, NextResponse } from "next/server";

const MAX_DEBUG_PAYLOAD_BYTES = 16 * 1024; // 16 KB

export async function POST(req: NextRequest) {
  // Disable in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Debug endpoint disabled in production." },
      { status: 404 },
    );
  }

  // Size limit to prevent log spam / memory abuse
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_DEBUG_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "Payload exceeds 16KB limit." },
      { status: 413 },
    );
  }

  try {
    const data = await req.json();
    const str = JSON.stringify(data, null, 2);
    // Truncate to at most 4KB before logging to avoid stderr overflow
    console.error("[DEBUG ERROR]", str.length > 4096 ? str.slice(0, 4096) + "... [truncated]" : str);
  } catch (e) {
    console.error("[DEBUG ERROR] parse failed", e);
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Debug endpoint disabled in production." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, msg: "debug endpoint active (dev only)" });
}
