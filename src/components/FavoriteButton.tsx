"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toggleFavoriteVenue } from "@/lib/play/favorites";

interface Props {
  venueId: string;
  initialFavorited: boolean;
  /** "icon": bare heart for a photo card's action row. "chip": labelled pill, for a text-link row like the venue detail page. */
  variant?: "icon" | "chip";
  size?: number;
}

export default function FavoriteButton({ venueId, initialFavorited, variant = "icon", size = 14 }: Props) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [pending, startTransition] = useTransition();

  function toggle(e: React.MouseEvent) {
    // Cards and rows this sits inside are usually themselves a link to
    // the venue — don't let the click fall through and navigate away.
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    const next = !favorited;
    setFavorited(next); // optimistic
    startTransition(async () => {
      try {
        setFavorited(await toggleFavoriteVenue(venueId));
      } catch {
        setFavorited(!next); // not signed in, or the request failed — revert
      }
    });
  }

  const color = favorited ? "#E5484D" : "currentColor";
  const heart = <Heart size={size} fill={favorited ? "#E5484D" : "none"} color={color} />;

  if (variant === "chip") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={favorited}
        aria-label={favorited ? "Remove from favorites" : "Save to favorites"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          background: "none", border: "none", padding: "10px 0", margin: "-10px 0",
          font: "inherit", fontWeight: 600, cursor: "pointer",
          color: favorited ? "#E5484D" : "#006241",
        }}
      >
        {heart} {favorited ? "Saved" : "Save"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={favorited}
      aria-label={favorited ? "Remove from favorites" : "Save to favorites"}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
        background: favorited ? "rgba(229,72,77,0.14)" : "var(--chip)",
        color, border: "none", cursor: "pointer", marginLeft: "auto",
      }}
    >
      {heart}
    </button>
  );
}
