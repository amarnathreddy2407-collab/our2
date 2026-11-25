"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import * as cloud from "./cloud";
import { useAdminAccess } from "@/components/admin/AdminAccess";

export const cloudOn = cloud.cloudOn;

const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open("our-universe", 4);
  r.onupgradeneeded = () => ["memories", "letters", "events", "places", "photos", "scratch"].forEach((n) => { if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, { keyPath: "id" }); });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const run = async <T,>(s: string, m: IDBTransactionMode, f: (o: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open();
  return new Promise<T>((res, rej) => { const q = f(db.transaction(s, m).objectStore(s)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
};

const cloudLoadError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("pgrst205") || message.includes("schema cache")) return "Supabase content tables are not installed. Apply the included SQL migration, then retry.";
  if (message.includes("supabase public credentials")) return "Supabase public configuration is missing.";
  return "Could not load published content. Check the connection and retry.";
};

export function useStore<T extends { id: string }>(name: string) {
  const { isAdmin, lock } = useAdminAccess();
  const [mutationError, setMutationError] = useState("");
  const key = cloud.cloudOn ? ["our-universe", name, isAdmin] as const : null;
  const { data, error: fetchError, isLoading, isValidating, mutate } = useSWR<T[], Error>(
    key,
    ([, store, admin]: readonly ["our-universe", string, boolean]) => cloud.list<T>(store, admin),
    { revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const error = !cloud.cloudOn ? "Supabase public configuration is missing." : fetchError ? cloudLoadError(fetchError) : mutationError;
  const ready = !isLoading && (data !== undefined || !!fetchError || !cloud.cloudOn);
  const retry = () => { setMutationError(""); void mutate(); };
  const save = async (item: T) => {
    if (!isAdmin) { setMutationError("Unlock admin tools to change published content."); return false; }
    setMutationError("");
    try {
      await cloud.put(name, item);
      await mutate();
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Cloud save failed.";
      if (message.includes("Admin access is required")) await lock();
      setMutationError(message);
      return false;
    }
  };
  const remove = async (id: string) => {
    if (!isAdmin) { setMutationError("Unlock admin tools to change published content."); return false; }
    setMutationError("");
    try {
      await cloud.del(name, id);
      await mutate();
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Cloud delete failed.";
      if (message.includes("Admin access is required")) await lock();
      setMutationError(message);
      return false;
    }
  };
  const hasCloudData = data !== undefined && !fetchError;
  useEffect(() => {
    if (!cloud.cloudOn || !hasCloudData) return;
    return cloud.subscribe(name, () => { void mutate(); });
  }, [hasCloudData, name, mutate]);
  return { items: data ?? [], ready, error, retry, isAdmin, save, remove, refreshing: isValidating };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const fmtDate = (d: string) => d ? new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";

export const shrink = (f: File, max = 1400) => new Promise<string>((res, rej) => {
  const img = new Image(), u = URL.createObjectURL(f);
  img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = img.width * k; c.height = img.height * k;
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(u); res(c.toDataURL("image/jpeg", 0.82));
  };
  img.onerror = () => rej(new Error("Could not read " + f.name));
  img.src = u;
});

export const MAX_VIDEO = 50 * 1024 * 1024;

export const videoPoster = (f: File, max = 1000) => new Promise<string>((res, rej) => {
  const v = document.createElement("video"), u = URL.createObjectURL(f);
  const fail = () => { URL.revokeObjectURL(u); rej(new Error("Could not read " + f.name)); };
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = u; v.onerror = fail;
  v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
  v.onseeked = () => {
    const k = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = v.videoWidth * k; c.height = v.videoHeight * k;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    URL.revokeObjectURL(u); res(c.toDataURL("image/jpeg", 0.8));
  };
  setTimeout(fail, 10000);
});

export async function readMedia(f: File): Promise<{ photo: string; video?: Blob | string }> {
  if (f.type.startsWith("video/")) {
    if (f.size > MAX_VIDEO) throw new Error(`${f.name} is over 50 MB. Trim it or pick a shorter clip.`);
    return { photo: await videoPoster(f), video: f };
  }
  return { photo: await shrink(f) };
}

export function useBlobUrl(b?: Blob | string) {
  const [u, setU] = useState<string>();
  useEffect(() => {
    if (!b) { setU(undefined); return; }
    if (typeof b === "string") { setU(b); return; }
    const x = URL.createObjectURL(b); setU(x);
    return () => URL.revokeObjectURL(x);
  }, [b]);
  return u;
}

const STORES = ["memories", "letters", "events", "photos", "scratch"];
export const countLocal = async () => {
  let n = 0;
  for (const store of STORES) n += (await run<unknown[]>(store, "readonly", (o) => o.getAll())).length;
  return n;
};

export const migrateLocal = async () => {
  if (!cloud.cloudOn) throw new Error("Supabase is not configured.");
  let moved = 0;
  for (const source of STORES) {
    const items = await run<{ id: string; [key: string]: unknown }[]>(source, "readonly", (o) => o.getAll());
    for (const item of items) {
      const destination = source === "photos" ? "scratch" : source;
      const record = source === "photos"
        ? { ...item, id: `legacy-photo-${item.id}`, caption: item.caption ?? "", at: item.at ?? moved }
        : item;
      await cloud.put(destination, record);
      await run(source, "readwrite", (o) => o.delete(item.id));
      moved++;
    }
  }
  return moved;
};
