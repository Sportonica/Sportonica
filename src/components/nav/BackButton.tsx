"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// Real history back — router.back(), not a fixed "parent" route. Wherever
// the user actually came from is where this takes them, same as a
// browser's own back button.
export default function BackButton({
  className, label, iconSize = 18,
}: { className?: string; label?: string; iconSize?: number }) {
  const router = useRouter();
  return (
    <button type="button" className={className} onClick={() => router.back()} aria-label="Go back">
      <ArrowLeft size={iconSize} strokeWidth={2.2} absoluteStrokeWidth />
      {label && <span>{label}</span>}
    </button>
  );
}
