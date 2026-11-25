"use client";
import { useCallback, useEffect, useState } from "react";
import * as cloud from "./cloud";

export const cloudOn = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);

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

const LOCAL_FALLBACK_EVENT = "our-universe:local-fallback";
let cloudFallbackActive = false;

const isMissingCloudResource = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("pgrst205") ||
    (message.includes("public.entries") && message.includes("schema cache")) ||
    message.includes("bucket not found");
};

const activateCloudFallback = () => {
  if (cloudFallbackActive) return;
  cloudFallbackActive = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_FALLBACK_EVENT));
};

export const isCloudFallbackActive = () => cloudFallbackActive;
export const subscribeToCloudFallback = (listener: () => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LOCAL_FALLBACK_EVENT, listener);
  if (cloudFallbackActive) listener();
  return () => window.removeEventListener(LOCAL_FALLBACK_EVENT, listener);
};

async function readItems<T>(name: string) {
  if (!cloudOn || cloudFallbackActive) return run<T[]>(name, "readonly", (o) => o.getAll());
  try {
    return await cloud.list<T>(name);
  } catch (error) {
    if (!isMissingCloudResource(error)) throw error;
    activateCloudFallback();
    return run<T[]>(name, "readonly", (o) => o.getAll());
  }
}

async function writeItem<T extends { id: string }>(name: string, item: T) {
  if (!cloudOn || cloudFallbackActive) return run(name, "readwrite", (o) => o.put(item));
  try {
    await cloud.put(name, item);
  } catch (error) {
    if (!isMissingCloudResource(error)) throw error;
    activateCloudFallback();
    await run(name, "readwrite", (o) => o.put(item));
  }
}

async function deleteItem(name: string, id: string) {
  if (!cloudOn || cloudFallbackActive) return run(name, "readwrite", (o) => o.delete(id));
  try {
    await cloud.del(name, id);
  } catch (error) {
    if (!isMissingCloudResource(error)) throw error;
    activateCloudFallback();
    await run(name, "readwrite", (o) => o.delete(id));
  }
}

export function useStore<T extends { id: string }>(name: string) {
  const [items, setItems] = useState<T[]>([]);
  const [ready, setReady] = useState(false);
  const load = useCallback(async () => {
    try { setItems(await readItems<T>(name)); }
    catch (error) { console.error(error); }
    setReady(true);
  }, [name]);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const refresh = () => { void load(); };
    const initialize = async () => {
      await load();
      if (!cancelled && cloudOn && !cloudFallbackActive) unsubscribe = cloud.subscribe(name, refresh);
    };
    void initialize();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      unsubscribe?.();
      window.removeEventListener("focus", refresh);
    };
  }, [load, name]);
  const save = async (item: T) => { await writeItem(name, item); await load(); };
  const remove = async (id: string) => { await deleteItem(name, id); await load(); };
  return { items, ready, save, remove };
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
  for (const s of STORES) n += (await run<unknown[]>(s, "readonly", (o) => o.getAll())).length;
  return n;
};
export const migrateLocal = async () => {
  let n = 0;
  for (const s of STORES) for (const i of await run<{ id: string }[]>(s, "readonly", (o) => o.getAll())) { await writeItem(s, i); n++; }
  return n;
};
