import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CONTENT_CONFIG, isContentStore, type ContentStore } from "./content-model";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const cloudOn = Boolean(supabaseUrl && supabasePublicKey);
let client: SupabaseClient | null = null;

function sb() {
  if (!supabaseUrl || !supabasePublicKey) throw new Error("Supabase public credentials are not configured.");
  return (client ??= createClient(supabaseUrl, supabasePublicKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }));
}

type AssetKind = "photo" | "video";
type ContentRow = Record<string, unknown>;
type UploadedAsset = { path: string | null; url: string | null; bucket: string | null; created: boolean };

async function signedAssetUrls(rows: ContentRow[], kind: AssetKind, defaultBucket?: string) {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    const path = row[`${kind}_path`];
    if (typeof path !== "string" || !path) continue;
    const bucket = typeof row[`${kind}_bucket`] === "string" ? row[`${kind}_bucket`] as string : defaultBucket;
    if (!bucket) continue;
    const paths = groups.get(bucket) ?? new Set<string>();
    paths.add(path);
    groups.set(bucket, paths);
  }

  const urls = new Map<string, string>();
  for (const [bucket, paths] of groups) {
    const values = [...paths];
    for (let index = 0; index < values.length; index += 100) {
      const { data, error } = await sb().storage.from(bucket).createSignedUrls(values.slice(index, index + 100), 60 * 60);
      if (error) throw new Error(error.message);
      for (const asset of data ?? []) {
        if (!asset.error && typeof asset.path === "string" && typeof asset.signedUrl === "string") urls.set(`${bucket}:${asset.path}`, asset.signedUrl);
      }
    }
  }
  return urls;
}

function resolveAssetUrl(row: ContentRow, kind: AssetKind, defaultBucket: string | undefined, urls: Map<string, string>) {
  const path = row[`${kind}_path`];
  const bucket = typeof row[`${kind}_bucket`] === "string" ? row[`${kind}_bucket`] as string : defaultBucket;
  if (typeof path === "string" && bucket) return urls.get(`${bucket}:${path}`) ?? "";
  const fallback = row[`${kind}_url`];
  return typeof fallback === "string" ? fallback : "";
}

function mapRow(store: ContentStore, row: ContentRow, photoUrls: Map<string, string>, videoUrls: Map<string, string>) {
  const config = CONTENT_CONFIG[store];
  if (store === "events") {
    return { ...row, date: row.event_date, photo: resolveAssetUrl(row, "photo", config.photoBucket, photoUrls), _photoPath: row.photo_path, _photoBucket: row.photo_bucket };
  }
  if (store === "memories") {
    return {
      ...row,
      date: row.memory_date,
      photo: resolveAssetUrl(row, "photo", config.photoBucket, photoUrls),
      video: resolveAssetUrl(row, "video", config.videoBucket, videoUrls) || undefined,
      _photoPath: row.photo_path,
      _photoBucket: row.photo_bucket,
      _videoPath: row.video_path,
      _videoBucket: row.video_bucket,
    };
  }
  if (store === "letters") return { ...row, date: row.letter_date };
  return {
    ...row,
    at: Number(row.display_order ?? 0),
    photo: resolveAssetUrl(row, "photo", config.photoBucket, photoUrls),
    video: resolveAssetUrl(row, "video", config.videoBucket, videoUrls) || undefined,
    _photoPath: row.photo_path,
    _photoBucket: row.photo_bucket,
    _videoPath: row.video_path,
    _videoBucket: row.video_bucket,
  };
}

export async function list<T>(store: string, admin = false): Promise<T[]> {
  if (!isContentStore(store)) return [];
  if (admin) {
    const response = await fetch(`/api/admin/content/${store}`, { cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(result?.items)) throw new Error(result?.error || "Could not load administrator content.");
    return result.items as T[];
  }
  const config = CONTENT_CONFIG[store];
  let query = sb().from(config.table).select(config.columns).eq("published", true);
  if (store === "letters") query = query.eq("draft", false);
  if (store === "events") query = query.order("event_date", { ascending: true });
  if (store === "memories") query = query.order("memory_date", { ascending: false });
  if (store === "letters") query = query.order("letter_date", { ascending: false });
  if (store === "scratch") query = query.order("display_order", { ascending: true });
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ContentRow[];
  const [photoUrls, videoUrls] = await Promise.all([
    signedAssetUrls(rows, "photo", config.photoBucket),
    signedAssetUrls(rows, "video", config.videoBucket),
  ]);
  return rows.map((row) => mapRow(store, row, photoUrls, videoUrls) as T);
}

async function uploadAsset(
  value: unknown,
  existingPath: unknown,
  existingUrl: unknown,
  existingBucket: unknown,
  defaultBucket: string | undefined,
  resource: ContentStore,
  id: string,
  kind: AssetKind,
  forceCopy = false,
): Promise<UploadedAsset> {
  let blob: Blob | null = null;
  if (typeof Blob !== "undefined" && value instanceof Blob) blob = value;
  else if (typeof value === "string" && value.startsWith("data:")) blob = await (await fetch(value)).blob();
  else if (typeof value === "string" && existingPath && existingBucket && defaultBucket && (existingBucket !== defaultBucket || forceCopy)) {
    const response = await fetch(value);
    if (!response.ok) throw new Error("Could not copy the existing media into the new storage bucket.");
    blob = await response.blob();
  }
  if (!blob) {
    return {
      path: typeof existingPath === "string" ? existingPath : null,
      url: typeof value === "string" && !value.startsWith("data:") ? value : typeof existingUrl === "string" ? existingUrl : null,
      bucket: typeof existingBucket === "string" ? existingBucket : defaultBucket ?? null,
      created: false,
    };
  }
  if (!defaultBucket) throw new Error("This content type does not support that media file.");
  const extension = blob.type.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg") || "bin";
  const form = new FormData();
  form.set("resource", resource);
  form.set("kind", kind);
  form.set("id", id);
  form.set("file", new File([blob], `${id}.${extension}`, { type: blob.type }));
  const response = await fetch("/api/admin/media", { method: "POST", body: form });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.path !== "string" || typeof result?.bucket !== "string") {
    throw new Error(result?.error || "Media upload failed.");
  }
  return { path: result.path, url: null, bucket: result.bucket, created: true };
}

async function removeUploadedAsset(resource: ContentStore, id: string, kind: AssetKind, bucket: string, path: string) {
  await fetch("/api/admin/media", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource, id, kind, bucket, path }),
  }).catch(() => {});
}

export async function put(store: string, item: { id: string; [key: string]: unknown }) {
  if (!isContentStore(store)) throw new Error("Unknown cloud content type.");
  const resource = store;
  const config = CONTENT_CONFIG[resource];
  const id = item.id;
  const created: { kind: AssetKind; bucket: string; path: string }[] = [];
  try {
    const photo = await uploadAsset(item.photo, item._photoPath, item.photo_url, item._photoBucket, config.photoBucket, resource, id, "photo", Boolean(item._copyMedia));
    if (photo.created && photo.bucket && photo.path) created.push({ kind: "photo", bucket: photo.bucket, path: photo.path });
    const video = await uploadAsset(item.video, item._videoPath, item.video_url, item._videoBucket, config.videoBucket, resource, id, "video", Boolean(item._copyMedia));
    if (video.created && video.bucket && video.path) created.push({ kind: "video", bucket: video.bucket, path: video.path });

    let row: Record<string, unknown>;
    if (resource === "events") {
      row = { id, title: item.title, event_date: item.date, description: item.description ?? "", location: item.location ?? "", photo_path: photo.path, photo_url: photo.path ? null : photo.url, photo_bucket: photo.bucket ?? config.photoBucket, published: item.published ?? true };
    } else if (resource === "memories") {
      row = { id, photo_path: photo.path, photo_url: photo.path ? null : photo.url, photo_bucket: photo.bucket ?? config.photoBucket, caption: item.caption ?? "", memory_date: item.date, location: item.location ?? "", fav: item.fav ?? false, rot: item.rot ?? 0, video_path: video.path, video_url: video.path ? null : video.url, video_bucket: video.bucket ?? config.videoBucket, published: item.published ?? true };
    } else if (resource === "letters") {
      row = { id, title: item.title, body: item.body, letter_date: item.date, fav: item.fav ?? false, draft: item.draft ?? false, published: item.published ?? true };
    } else {
      row = { id, photo_path: photo.path, photo_url: photo.path ? null : photo.url, photo_bucket: photo.bucket ?? config.photoBucket, caption: item.caption ?? "", display_order: item.at ?? 0, video_path: video.path, video_url: video.path ? null : video.url, video_bucket: video.bucket ?? config.videoBucket, published: item.published ?? true };
    }

    const response = await fetch(`/api/admin/content/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || "Cloud save failed.");
  } catch (error) {
    await Promise.all(created.map((asset) => removeUploadedAsset(resource, id, asset.kind, asset.bucket, asset.path)));
    throw error;
  }
}

export async function del(store: string, id: string) {
  if (!isContentStore(store)) throw new Error("Unknown cloud content type.");
  const response = await fetch(`/api/admin/content/${store}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "Cloud delete failed.");
}

export function subscribe(store: string, cb: () => void) {
  if (!isContentStore(store)) return () => {};
  const table = CONTENT_CONFIG[store].table;
  const channel = sb().channel(`ou-${table}`)
    .on("postgres_changes", { event: "*", schema: "public", table }, () => cb())
    .subscribe();
  return () => { void sb().removeChannel(channel); };
}
