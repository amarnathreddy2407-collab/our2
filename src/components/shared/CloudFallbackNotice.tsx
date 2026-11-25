"use client";
import { useEffect, useState } from "react";
import { isCloudFallbackActive, subscribeToCloudFallback } from "@/lib/store";

export default function CloudFallbackNotice() {
  const [active, setActive] = useState(isCloudFallbackActive);

  useEffect(() => subscribeToCloudFallback(() => setActive(true)), []);

  if (!active) return null;
  return (
    <p role="status" aria-live="polite" className="mb-5 rounded-xl border border-amber-200/40 bg-amber-100/10 px-4 py-3 text-center text-sm text-amber-100">
      Supabase storage is not fully configured. Changes are saved only in this browser; cloud sync is unavailable.
    </p>
  );
}
