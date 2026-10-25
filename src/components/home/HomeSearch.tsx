"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin } from "lucide-react";
import { SPORT_NAMES, sportColor } from "@/lib/sports";
import { CITIES, useCity, type City, type Area } from "@/lib/city";
import { searchVenues, type VenueSearchHit } from "@/lib/play/searchVenues";

type Hit =
  | { kind: "sport"; label: string }
  | { kind: "place"; label: string; city: City; area: Area | null }
  | { kind: "venue"; label: string; sub: string | null; id: string };

const MAX_PER_GROUP = 4;

// The one search box in the app that spans all three things a player
// actually types here — a sport, a venue, or a place — instead of the
// area-only search buried in the header's location picker.
export default function HomeSearch() {
  const router = useRouter();
  const { setCity } = useCity();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [venueHits, setVenueHits] = useState<VenueSearchHit[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  // Venues need a round trip; sports and places are answered from data
  // already on the client, so only this half debounces.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setVenueHits([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchVenues(needle).then((hits) => { if (!cancelled) setVenueHits(hits); }).catch(() => {});
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const needle = q.trim().toLowerCase();

  const sportHits: Hit[] = needle.length === 0 ? [] : SPORT_NAMES
    .filter((s) => s.toLowerCase().includes(needle))
    .slice(0, MAX_PER_GROUP)
    .map((s) => ({ kind: "sport", label: s }));

  const placeHits: Hit[] = [];
  if (needle.length >= 2) {
    outer: for (const city of CITIES) {
      if (city.name.toLowerCase().includes(needle)) {
        placeHits.push({ kind: "place", label: `${city.name}, ${city.province}`, city, area: null });
        if (placeHits.length >= MAX_PER_GROUP) break;
      }
      for (const area of city.areas) {
        if (area.name.toLowerCase().includes(needle)) {
          placeHits.push({ kind: "place", label: `${area.name}, ${city.name}`, city, area });
          if (placeHits.length >= MAX_PER_GROUP) break outer;
        }
      }
    }
  }

  const venueResultHits = venueHits.map((v) => ({ kind: "venue" as const, label: v.name, sub: v.address, id: v.id }));
  const hits = [...sportHits, ...placeHits, ...venueResultHits];

  function go(hit: Hit) {
    setOpen(false);
    setQ("");
    if (hit.kind === "sport") { router.push(`/create?sport=${encodeURIComponent(hit.label)}`); return; }
    if (hit.kind === "venue") { router.push(`/create/${hit.id}`); return; }
    setCity(hit.city, hit.area);
    router.push("/create");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // No exact pick made — take the best-ranked hit if there is one,
    // otherwise just open the full grounds list rather than doing nothing.
    if (hits.length > 0) go(hits[0]);
    else router.push("/create");
  }

  return (
    <div className="p-search" ref={boxRef}>
      <form onSubmit={onSubmit} className="p-search-bar">
        <Search size={17} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search sport, venue or location"
          aria-label="Search sport, venue or location"
        />
      </form>

      {open && needle.length > 0 && (
        <div className="p-search-drop">
          {hits.length === 0 ? (
            <div className="p-search-empty">Nothing matches &ldquo;{q}&rdquo; yet.</div>
          ) : (
            <>
              {sportHits.length > 0 && <div className="p-search-label">Sports</div>}
              {sportHits.map((h) => (
                <button key={`sport-${h.label}`} type="button" className="p-search-row" onClick={() => go(h)}>
                  <span className="p-search-dot" style={{ background: sportColor(h.label) }} />
                  {h.label}
                </button>
              ))}

              {placeHits.length > 0 && <div className="p-search-label">Locations</div>}
              {placeHits.map((h, i) => (
                <button key={`place-${i}`} type="button" className="p-search-row" onClick={() => go(h)}>
                  <MapPin size={14} /> {h.label}
                </button>
              ))}

              {venueResultHits.length > 0 && <div className="p-search-label">Venues</div>}
              {venueResultHits.map((h) => (
                <button key={`venue-${h.id}`} type="button" className="p-search-row" onClick={() => go(h)}>
                  <MapPin size={14} />
                  <span>
                    {h.label}
                    {h.sub && <small>{h.sub}</small>}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <style>{`
        .p-search { position: relative; margin: 20px 0 4px; max-width: 640px; }
        .p-search-bar {
          display: flex; align-items: center; gap: 10px;
          background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14);
          border-radius: 999px; padding: 14px 20px; backdrop-filter: blur(10px);
          transition: border-color .2s, background .2s;
        }
        .p-search-bar:focus-within { border-color: #006241; background: rgba(255,255,255,0.09); }
        [data-theme="paper"] .p-search-bar { background: rgba(20,23,30,0.04); border-color: rgba(20,23,30,0.14); }
        [data-theme="paper"] .p-search-bar:focus-within { border-color: #006241; background: rgba(20,23,30,0.07); }
        .p-search-bar svg { flex-shrink: 0; opacity: 0.6; color: var(--chalk, #F2EDE6); }
        [data-theme="paper"] .p-search-bar svg { color: #14171E; }
        .p-search-bar input {
          flex: 1; min-width: 0; background: none; border: none; outline: none;
          font: inherit; font-size: 15px; color: var(--chalk, #F2EDE6); font-family: 'Inter', sans-serif;
        }
        [data-theme="paper"] .p-search-bar input { color: #14171E; }
        .p-search-bar input::placeholder { color: rgba(242,237,230,0.45); }
        [data-theme="paper"] .p-search-bar input::placeholder { color: rgba(20,23,30,0.4); }

        .p-search-drop {
          position: absolute; top: calc(100% + 8px); left: 0; right: 0; z-index: 60;
          background: var(--inkSoft, #14171E); border: 1px solid rgba(255,255,255,0.12);
          border-radius: 16px; overflow-y: auto; max-height: 360px;
          box-shadow: 0 24px 50px -20px rgba(0,0,0,0.6);
        }
        [data-theme="paper"] .p-search-drop {
          background: #fff; border-color: rgba(20,23,30,0.12);
          box-shadow: 0 24px 50px -22px rgba(20,23,30,0.3);
        }
        .p-search-label {
          font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
          color: #006241; padding: 12px 16px 4px;
        }
        .p-search-row {
          display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
          background: none; border: none; cursor: pointer; padding: 10px 16px;
          font: inherit; font-size: 14px; font-weight: 600; color: var(--chalk, #F2EDE6);
        }
        [data-theme="paper"] .p-search-row { color: #14171E; }
        .p-search-row:hover { background: rgba(0,98,65,0.1); }
        .p-search-row svg { flex-shrink: 0; opacity: 0.65; }
        .p-search-row small { display: block; font-size: 11.5px; font-weight: 500; opacity: 0.6; margin-top: 2px; }
        .p-search-dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
        .p-search-empty { padding: 18px 16px; font-size: 13.5px; opacity: 0.6; }

        @media (max-width: 560px) {
          .p-search-bar { padding: 12px 16px; }
          .p-search-bar input { font-size: 14px; }
        }
      `}</style>
    </div>
  );
}
