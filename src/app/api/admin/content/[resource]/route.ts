import { NextRequest, NextResponse } from "next/server";
import { CONTENT_CONFIG, isContentStore, type ContentStore } from "@/lib/content-model";
import { createAdminSupabaseClient, hasValidAdminSession, isSameOriginRequest } from "@/lib/admin/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ resource: string }> };
type Row = Record<string, unknown>;

function safeString(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return required ? null : "";
  const result = value.trim();
  if ((required && !result) || result.length > maximum) return null;
  return result;
}

function safeDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function safeBucket(value: unknown, defaultBucket: string | undefined) {
  if (value === null || value === undefined || value === "") return defaultBucket ?? null;
  if (typeof value !== "string") return null;
  return value === "media" || value === defaultBucket ? value : null;
}

function safePath(value: unknown, resource: string, id: string, bucket: string | null) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 600 || value.startsWith("/") || value.includes("..")) return null;
  if (bucket === "media") return /^[a-zA-Z0-9/_-]+[.][a-zA-Z0-9]+$/.test(value) ? value : null;
  return value.startsWith(`${resource}/${id}/`) ? value : null;
}

function safeUrl(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 4096) return null;
  try { return new URL(value).protocol === "https:" ? value : null; }
  catch { return null; }
}

function optionalBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeRecord(resource: ContentStore, value: unknown): Row | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Row;
  const id = safeString(body.id, 120, true);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const common = { id, published: optionalBoolean(body.published, true), updated_at: new Date().toISOString() };
  const config = CONTENT_CONFIG[resource];
  const photo_bucket = safeBucket(body.photo_bucket, config.photoBucket);
  const photo_path = safePath(body.photo_path, resource, id, photo_bucket);
  const photo_url = safeUrl(body.photo_url);

  if (resource === "events") {
    const title = safeString(body.title, 240, true);
    const event_date = safeDate(body.event_date);
    if (!title || !event_date || (body.photo_path && !photo_path) || (body.photo_url && !photo_url)) return null;
    return { ...common, title, event_date, description: safeString(body.description, 10000) ?? "", location: safeString(body.location, 500) ?? "", photo_path, photo_url, photo_bucket };
  }

  if (resource === "memories") {
    const memory_date = safeDate(body.memory_date);
    const rot = typeof body.rot === "number" && Number.isFinite(body.rot) ? Math.max(-4, Math.min(4, body.rot)) : 0;
    const video_bucket = safeBucket(body.video_bucket, config.videoBucket);
    const video_path = safePath(body.video_path, resource, id, video_bucket);
    const video_url = safeUrl(body.video_url);
    if (!memory_date || (body.photo_path && !photo_path) || (body.photo_url && !photo_url) || (body.video_path && !video_path) || (body.video_url && !video_url) || (body.photo_bucket && !photo_bucket) || (body.video_bucket && !video_bucket)) return null;
    if (!photo_path && !photo_url) return null;
    return { ...common, memory_date, caption: safeString(body.caption, 5000) ?? "", location: safeString(body.location, 500) ?? "", fav: optionalBoolean(body.fav), rot, photo_path, photo_url, photo_bucket, video_path, video_url, video_bucket };
  }

  if (resource === "letters") {
    const title = safeString(body.title, 240, true);
    const bodyText = safeString(body.body, 30000, true);
    const letter_date = safeDate(body.letter_date);
    if (!title || !bodyText || !letter_date) return null;
    return { ...common, title, body: bodyText, letter_date, fav: optionalBoolean(body.fav), draft: optionalBoolean(body.draft) };
  }

  const display_order = typeof body.display_order === "number" && Number.isSafeInteger(body.display_order) ? body.display_order : 0;
  const video_bucket = safeBucket(body.video_bucket, config.videoBucket);
  const video_path = safePath(body.video_path, resource, id, video_bucket);
  const video_url = safeUrl(body.video_url);
  if ((body.photo_path && !photo_path) || (body.photo_url && !photo_url) || (body.video_path && !video_path) || (body.video_url && !video_url) || (body.photo_bucket && !photo_bucket) || (body.video_bucket && !video_bucket)) return null;
  if (!photo_path && !photo_url) return null;
  return { ...common, photo_path, photo_url, photo_bucket, video_path, video_url, video_bucket, caption: safeString(body.caption, 5000) ?? "", display_order };
}

async function cleanupChangedAssets(client: ReturnType<typeof createAdminSupabaseClient>, resource: ContentStore, oldRow: Row | null, newRow: Row) {
  if (!oldRow) return;
  const config = CONTENT_CONFIG[resource];
  const assets: { bucket: string; path: string }[] = [];
  const photoBucket = typeof oldRow.photo_bucket === "string" ? oldRow.photo_bucket : config.photoBucket;
  const videoBucket = typeof oldRow.video_bucket === "string" ? oldRow.video_bucket : config.videoBucket;
  if (photoBucket && typeof oldRow.photo_path === "string" && oldRow.photo_path !== newRow.photo_path) assets.push({ bucket: photoBucket, path: oldRow.photo_path });
  if (videoBucket && typeof oldRow.video_path === "string" && oldRow.video_path !== newRow.video_path) assets.push({ bucket: videoBucket, path: oldRow.video_path });
  for (const asset of assets) {
    const { error } = await client.storage.from(asset.bucket).remove([asset.path]);
    if (error) console.error("[admin] Replaced media cleanup failed.");
  }
}

async function signedAssetMap(client: ReturnType<typeof createAdminSupabaseClient>, rows: Row[], kind: "photo" | "video", defaultBucket: string | undefined) {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const path = row[`${kind}_path`];
    if (typeof path !== "string" || !path) continue;
    const bucket = typeof row[`${kind}_bucket`] === "string" ? row[`${kind}_bucket`] as string : defaultBucket;
    if (!bucket) continue;
    const paths = grouped.get(bucket) ?? new Set<string>();
    paths.add(path);
    grouped.set(bucket, paths);
  }
  const signed = new Map<string, string>();
  for (const [bucket, paths] of grouped) {
    const values = [...paths];
    for (let index = 0; index < values.length; index += 100) {
      const { data, error } = await client.storage.from(bucket).createSignedUrls(values.slice(index, index + 100), 60 * 60);
      if (error) throw error;
      for (const asset of data ?? []) {
        if (!asset.error && typeof asset.path === "string" && typeof asset.signedUrl === "string") signed.set(`${bucket}:${asset.path}`, asset.signedUrl);
      }
    }
  }
  return signed;
}

function adminView(resource: ContentStore, row: Row, photoUrls: Map<string, string>, videoUrls: Map<string, string>) {
  const config = CONTENT_CONFIG[resource];
  const photoBucket = typeof row.photo_bucket === "string" ? row.photo_bucket : config.photoBucket;
  const videoBucket = typeof row.video_bucket === "string" ? row.video_bucket : config.videoBucket;
  const photoPath = typeof row.photo_path === "string" ? row.photo_path : null;
  const videoPath = typeof row.video_path === "string" ? row.video_path : null;
  const photo = photoPath && photoBucket ? photoUrls.get(`${photoBucket}:${photoPath}`) ?? "" : row.photo_url ?? "";
  const video = videoPath && videoBucket ? videoUrls.get(`${videoBucket}:${videoPath}`) : row.video_url;
  if (resource === "events") return { ...row, date: row.event_date, photo, _photoPath: photoPath, _photoBucket: photoBucket };
  if (resource === "memories") return { ...row, date: row.memory_date, photo, video, _photoPath: photoPath, _photoBucket: photoBucket, _videoPath: videoPath, _videoBucket: videoBucket };
  if (resource === "letters") return { ...row, date: row.letter_date };
  return { ...row, at: Number(row.display_order ?? 0), photo, video, _photoPath: photoPath, _photoBucket: photoBucket, _videoPath: videoPath, _videoBucket: videoBucket };
}

export async function GET(request: NextRequest, { params }: Context) {
  if (!hasValidAdminSession(request)) return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  const { resource } = await params;
  if (!isContentStore(resource)) return NextResponse.json({ error: "Unknown content type." }, { status: 404 });
  try {
    const client = createAdminSupabaseClient();
    const config = CONTENT_CONFIG[resource];
    const orderColumn = resource === "events" ? "event_date" : resource === "memories" ? "memory_date" : resource === "letters" ? "letter_date" : "display_order";
    const { data, error } = await client.from(config.table).select(config.columns).order(orderColumn, { ascending: resource === "events" || resource === "scratch" });
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    const [photoUrls, videoUrls] = await Promise.all([
      signedAssetMap(client, rows, "photo", config.photoBucket),
      signedAssetMap(client, rows, "video", config.videoBucket),
    ]);
    return NextResponse.json({ items: rows.map((row) => adminView(resource, row, photoUrls, videoUrls)) });
  } catch (error) {
    console.error("[admin] Content read failed.", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Could not load administrator content." }, { status: 503 });
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!hasValidAdminSession(request)) return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  const { resource } = await params;
  if (!isContentStore(resource)) return NextResponse.json({ error: "Unknown content type." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const row = normalizeRecord(resource, body);
  if (!row) return NextResponse.json({ error: "Please review the content fields and try again." }, { status: 400 });

  try {
    const client = createAdminSupabaseClient();
    const config = CONTENT_CONFIG[resource];
    const selected = resource === "events" ? "photo_path,photo_bucket" : resource === "memories" || resource === "scratch" ? "photo_path,photo_bucket,video_path,video_bucket" : "id";
    const { data: oldRow, error: readError } = await client.from(config.table).select(selected).eq("id", row.id as string).maybeSingle();
    if (readError) throw readError;
    const { error: saveError } = await client.from(config.table).upsert(row, { onConflict: "id" });
    if (saveError) throw saveError;
    await cleanupChangedAssets(client, resource, oldRow as unknown as Row | null, row);
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("[admin] Content save failed.", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "The cloud save failed. Retry after checking the Supabase migration." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!hasValidAdminSession(request)) return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  const { resource } = await params;
  if (!isContentStore(resource)) return NextResponse.json({ error: "Unknown content type." }, { status: 404 });
  let body: { id?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const id = safeString(body.id, 120, true);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return NextResponse.json({ error: "Invalid content id." }, { status: 400 });

  try {
    const client = createAdminSupabaseClient();
    const config = CONTENT_CONFIG[resource];
    const selected = resource === "events" ? "photo_path,photo_bucket" : resource === "memories" || resource === "scratch" ? "photo_path,photo_bucket,video_path,video_bucket" : "id";
    const { data: oldRow, error: readError } = await client.from(config.table).select(selected).eq("id", id).maybeSingle();
    if (readError) throw readError;
    if (!oldRow) return NextResponse.json({ error: "Content was not found." }, { status: 404 });
    const { error: deleteError } = await client.from(config.table).delete().eq("id", id);
    if (deleteError) throw deleteError;
    await cleanupChangedAssets(client, resource, oldRow as unknown as Row, {});
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("[admin] Content delete failed.", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "The cloud delete failed." }, { status: 503 });
  }
}
