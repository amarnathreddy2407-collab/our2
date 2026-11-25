import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";

export const ADMIN_COOKIE = "our-universe-admin";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

function getAdminToken() {
  const token = process.env.OUR_UNIVERSE_ADMIN_TOKEN;
  return token && token.length >= 32 ? token : null;
}

export function isAdminTokenConfigured() {
  return getAdminToken() !== null;
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isValidAdminToken(candidate: unknown) {
  const expected = getAdminToken();
  return typeof candidate === "string" && !!expected && constantTimeEqual(candidate, expected);
}

function signExpiry(expiresAt: number, secret: string) {
  return createHmac("sha256", secret).update(`our-universe-admin:${expiresAt}`).digest("base64url");
}

export function createAdminSessionValue() {
  const secret = getAdminToken();
  if (!secret) throw new Error("Admin token is missing or too short.");
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  return `${expiresAt}.${signExpiry(expiresAt, secret)}`;
}

export function hasValidAdminCookie(value?: string) {
  const secret = getAdminToken();
  if (!secret || !value) return false;
  const [expiresAtText, signature, extra] = value.split(".");
  if (!expiresAtText || !signature || extra !== undefined || !/^\d+$/.test(expiresAtText)) return false;
  const expiresAt = Number(expiresAtText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + ADMIN_SESSION_SECONDS + 60) return false;
  return constantTimeEqual(signature, signExpiry(expiresAt, secret));
}

export function hasValidAdminSession(request: NextRequest) {
  return hasValidAdminCookie(request.cookies.get(ADMIN_COOKIE)?.value);
}

export function isSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
    const requestHost = (forwardedHost || request.headers.get("host") || new URL(request.url).host).toLowerCase();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
    const protocol = forwardedProto || new URL(request.url).protocol.replace(":", "");
    return originHost === requestHost && (process.env.NODE_ENV !== "production" || protocol === "https");
  } catch {
    return false;
  }
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/api/admin",
    maxAge: ADMIN_SESSION_SECONDS,
  };
}

export function clearAdminCookie(response: NextResponse) {
  response.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions(), maxAge: 0 });
  return response;
}

export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error("Server-side Supabase credentials are not configured.");
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
