import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
const sb = () => {
  if (!supabaseUrl || !supabasePublicKey) {
    throw new Error("Supabase is not configured. Provide NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  return (client ??= createClient(supabaseUrl, supabasePublicKey));
};

async function upload(store: string, id: string, b: Blob, ext: string) {
  const path = `${store}/${id}-${Date.now()}.${ext}`;
  const { error } = await sb().storage.from("media").upload(path, b, { contentType: b.type, upsert: true });
  if (error) throw new Error(error.message);
  return sb().storage.from("media").getPublicUrl(path).data.publicUrl;
}

export async function list<T>(store: string): Promise<T[]> {
  const { data, error } = await sb().from("entries").select("id,data").eq("store", store);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r.data, id: r.id }) as T);
}

export async function put(store: string, item: { id: string; [k: string]: unknown }) {
  const d: Record<string, unknown> = { ...item };
  if (typeof d.photo === "string" && d.photo.startsWith("data:")) d.photo = await upload(store, item.id, await (await fetch(d.photo)).blob(), "jpg");
  if (d.video instanceof Blob) d.video = await upload(store, item.id, d.video, (d.video.type.split("/")[1] || "mp4").split(";")[0]);
  const { error } = await sb().from("entries").upsert({ store, id: item.id, data: d });
  if (error) throw new Error(error.message);
}

export async function del(store: string, id: string) {
  const { error } = await sb().from("entries").delete().eq("store", store).eq("id", id);
  if (error) throw new Error(error.message);
}

export function subscribe(store: string, cb: () => void) {
  const ch = sb().channel(`e-${store}-${Math.random()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "entries", filter: `store=eq.${store}` }, () => cb())
    .subscribe();
  return () => { sb().removeChannel(ch); };
}
