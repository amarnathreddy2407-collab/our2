"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { LockKeyhole, LockKeyholeOpen } from "lucide-react";

type AdminContextValue = { isAdmin: boolean; unlock: (token: string) => Promise<void>; lock: () => Promise<void> };
const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminAccessProvider({ children, initialAdmin }: { children: React.ReactNode; initialAdmin: boolean }) {
  const [isAdmin, setIsAdmin] = useState(initialAdmin);

  const unlock = useCallback(async (token: string) => {
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || "Admin access could not be verified.");
    }
    setIsAdmin(true);
  }, []);

  const lock = useCallback(async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    setIsAdmin(false);
  }, []);

  const value = useMemo(() => ({ isAdmin, unlock, lock }), [isAdmin, unlock, lock]);
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminAccess() {
  const value = useContext(AdminContext);
  if (!value) throw new Error("AdminAccessProvider is required.");
  return value;
}

export function AdminAccessControl() {
  const { isAdmin, unlock, lock } = useAdminAccess();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await unlock(token);
      setToken("");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin access could not be verified.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 flex justify-end">
      {isAdmin ? (
        <button onClick={() => void lock()} className="inline-flex items-center gap-2 rounded-full border border-lavender/40 px-4 py-2 text-sm text-lavender">
          <LockKeyholeOpen size={16} /> Lock admin tools
        </button>
      ) : (
        <button onClick={() => { setError(""); setOpen(true); }} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm text-white/60 hover:text-white">
          <LockKeyhole size={16} /> Admin access
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="admin-access-title">
          <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-lavender/30 bg-[#111329] p-6 shadow-2xl">
            <h2 id="admin-access-title" className="font-serif text-3xl">Admin access</h2>
            <label className="block space-y-2 text-sm text-white/70">
              <span>Administrator token</span>
              <input autoFocus type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} required className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white" />
            </label>
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => { setOpen(false); setToken(""); setError(""); }} className="px-4 py-2 text-white/60">Cancel</button>
              <button disabled={busy} className="rounded-full bg-gradient-to-r from-lavender to-pink px-5 py-2 font-semibold text-navy disabled:opacity-50">{busy ? "Checking..." : "Unlock"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
