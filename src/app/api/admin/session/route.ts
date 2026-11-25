import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  clearAdminCookie,
  createAdminSessionValue,
  hasValidAdminSession,
  isSameOriginRequest,
  isAdminTokenConfigured,
  isValidAdminToken,
} from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authenticated = hasValidAdminSession(request);
  return NextResponse.json({ authenticated }, { status: authenticated ? 200 : 401 });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!isAdminTokenConfigured()) return NextResponse.json({ error: "Admin access is not configured securely." }, { status: 503 });
  let body: { token?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!isValidAdminToken(body.token)) return NextResponse.json({ error: "Admin access could not be verified." }, { status: 401 });
  try {
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(ADMIN_COOKIE, createAdminSessionValue(), adminCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: "Admin access is not configured securely." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  return clearAdminCookie(NextResponse.json({ authenticated: false }));
}
