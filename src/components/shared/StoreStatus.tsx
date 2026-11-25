"use client";

export default function StoreStatus({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  if (loading) return <p role="status" className="py-8 text-center text-white/60">Loading cloud content...</p>;
  if (!error) return null;
  return (
    <div role="alert" className="my-6 rounded-xl border border-rose-300/30 bg-rose-950/40 p-4 text-center text-rose-100">
      <p>{error}</p>
      <button onClick={onRetry} className="mt-3 rounded-full border border-rose-200/40 px-4 py-2 text-sm hover:bg-white/10">Retry</button>
    </div>
  );
}
