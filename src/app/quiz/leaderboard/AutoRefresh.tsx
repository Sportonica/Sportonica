"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// keeps a big screen at the stall up to date without anyone touching it
export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
