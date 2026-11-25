import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CONTENT_CONFIG, isContentStore, type ContentStore } from "@/lib/content-model";
import { createAdminSupabaseClient, hasValidAdminSession, isSameOriginRequest } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function resolveBucket(resource: ContentStore, kind: string, requested?: string) {
  const config = CONTENT_CONFIG[resource];
  const expected = kind === "photo" ? config.photoBucket : kind === "video" ? config.videoBucket : undefined;
  if (!expected) return undefined;
  if (requested === "media") return "media";
  return !requested || requested === expected ? expected : undefined;
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "item";
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!hasValidAdminSession(request)) return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const resource = form.get("resource");
  const kind = form.get("kind");
  const id = form.get("id");
  const file = form.get("file");
  if (typeof resource !== "string" || !isContentStore(resource) || typeof kind !== "string" || typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(id) || !(file instanceof File)) {
    return NextResponse.json({ error: "Invalid upload fields." }, { status: 400 });
  }
  const bucket = resolveBucket(resource, kind);
  if (!bucket || !EXTENSIONS[file.type] || file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Unsupported file type or file exceeds 50 MB." }, { status: 400 });
  }

  const path = `${resource}/${safeSegment(id)}/${randomUUID()}.${EXTENSIONS[file.type]}`;
  try {
    const client = createAdminSupabaseClient();
    const { error } = await client.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return NextResponse.json({ path, bucket });
  } catch (error) {
    console.error("[admin] Media upload failed.", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "The media upload failed. Retry after checking the Supabase migration." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!hasValidAdminSession(request)) return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  let body: { resource?: unknown; kind?: unknown; id?: unknown; path?: unknown; bucket?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid media request." }, { status: 400 }); }
  if (typeof body.resource !== "string" || !isContentStore(body.resource) || typeof body.kind !== "string" || typeof body.id !== "string" || typeof body.path !== "string") {
    return NextResponse.json({ error: "Invalid media fields." }, { status: 400 });
  }
  const bucket = resolveBucket(body.resource, body.kind, typeof body.bucket === "string" ? body.bucket : undefined);
  const id = safeSegment(body.id);
  const pathBelongsToItem = body.path.startsWith(`${body.resource}/${id}/`);
  const legacyMediaPath = bucket === "media" && /^[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(body.path);
  if (!bucket || (!pathBelongsToItem && !legacyMediaPath) || body.path.includes("..")) {
    return NextResponse.json({ error: "Media path is not valid for this item." }, { status: 400 });
  }
  try {
    const { error } = await createAdminSupabaseClient().storage.from(bucket).remove([body.path]);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("[admin] Media cleanup failed.", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "The media cleanup failed." }, { status: 503 });
  }
}
