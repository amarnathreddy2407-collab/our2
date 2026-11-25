"use client";
import { useEffect, useState } from "react";
import { useAdminAccess } from "@/components/admin/AdminAccess";
import { cloudOn, countLocal, migrateLocal } from "@/lib/store";

export default function MigrateLocal() {
  const { isAdmin } = useAdminAccess();
  const [n, setN] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!cloudOn || !isAdmin) return;
    countLocal().then(setN).catch(() => setMsg("Could not inspect saved items in this browser."));
  }, [isAdmin]);
  if (!cloudOn || !isAdmin || (!n && !msg)) return null;
  return (
    <section className="glass p-5 text-center" role="status">
      {msg ? <p>{msg}</p> : (
        <>
          <p>This browser has {n} older saved items that can be moved to Supabase.</p>
          <button disabled={busy} className="mt-3 rounded-full bg-gradient-to-r from-lavender to-pink px-5 py-2 font-semibold text-navy disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              setMsg("");
              try { const count = await migrateLocal(); setN(await countLocal()); setMsg(`Moved ${count} items to Supabase.`); }
              catch (error) { setMsg(error instanceof Error ? error.message : "Could not migrate saved items."); }
              finally { setBusy(false); }
            }}>{busy ? "Moving..." : "Move old items to Supabase"}</button>
        </>
      )}
    </section>
  );
}
