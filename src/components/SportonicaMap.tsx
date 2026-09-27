"use client";

/**
 * SportonicaMap — shared Leaflet map used across:
 *   - /discover  (read-only, shows event pins)
 *   - /create    (read-only, shows venue pin from address)
 *   - /admin/venue (pick-a-point, updates lat/lng)
 *
 * Uses OpenStreetMap tiles — no API key required.
 */

import { useEffect, useRef, useState } from "react";
import { sportColor, normalizeSport } from "@/lib/sports";

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sport?: string;
  flash?: boolean;
  color?: string;
};

interface Props {
  /** Centre of the map on first render */
  center?: [number, number];
  zoom?: number;
  /** Pins to show. If empty just shows the basemap. */
  pins?: MapPin[];
  /** If true, clicking the map fires onPick with the lat/lng */
  pickMode?: boolean;
  onPick?: (lat: number, lng: number) => void;
  /** Called with the pin id when a pin is clicked. */
  onPinClick?: (id: string) => void;
  height?: string;
  borderRadius?: string;
}

// Kathmandu city centre default
const KTM: [number, number] = [27.7172, 85.324];

export default function SportonicaMap({
  center = KTM,
  zoom = 14,
  pins = [],
  pickMode = false,
  onPick,
  onPinClick,
  height = "100%",
  borderRadius = "0",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<import("leaflet").Map | null>(null);
  const [picked, setPicked] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return; // already initialised
    // Synchronous lock: the async import below resolves too late to stop a
    // second effect run (React strict-mode double-invoke), so mark the
    // container itself as claimed the instant this effect starts.
    const el = containerRef.current;
    if ((el as HTMLElement & { _leafletClaimed?: boolean })._leafletClaimed) return;
    (el as HTMLElement & { _leafletClaimed?: boolean })._leafletClaimed = true;

    // Leaflet must be imported client-side only
    import("leaflet").then(L => {
      // Fix default icon paths broken by webpack
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(containerRef.current!, {
        center,
        zoom,
        zoomControl: true,
        attributionControl: true,
      });

      // Light, clean basemap (CartoDB Positron — free, no key)
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 19,
        }
      ).addTo(map);

      // ── Pins, clustered ──
      // Several games (or an event and its venue) often share the exact
      // same coordinates — plain markers would stack invisibly on top of
      // each other. Group by on-screen pixel distance instead of by
      // coordinate so it works the same whether pins merely overlap at
      // this zoom or sit on literally the same point.
      function pinMarker(pin: MapPin) {
        const color = pin.flash ? "#E85D24" : (pin.color ?? sportColor(normalizeSport(pin.sport)));
        const svgIcon = L.divIcon({
          className: "",
          html: `
            <div style="
              background:${color};
              color:#fff;
              padding:4px 10px;
              border-radius:10px;
              font-size:11px;
              font-weight:700;
              font-family:'Inter',sans-serif;
              white-space:nowrap;
              box-shadow:0 2px 12px rgba(0,0,0,0.5);
              display:flex;align-items:center;gap:4px;
            ">
              ${pin.flash ? "⚡ " : ""}${pin.label}
            </div>
            <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${color};margin:0 auto;"></div>
          `,
          iconAnchor: [40, 28],
          popupAnchor: [0, -28],
        });

        const marker = L.marker([pin.lat, pin.lng], { icon: svgIcon })
          .bindPopup(`
            <div style="font-family:'Inter',sans-serif;font-size:13px;font-weight:600;color:#1e293b;">
              ${pin.label}${pin.sport ? `<br><span style="color:${color};font-weight:700">${pin.sport}</span>` : ""}
              <br><a href="https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:4px;margin-top:6px;color:#006241;font-weight:700;text-decoration:none;font-size:12px;">Get directions →</a>
            </div>
          `);
        if (onPinClick) marker.on("click", () => onPinClick(pin.id));
        return marker;
      }

      function clusterMarker(group: MapPin[]) {
        const lat = group.reduce((s, p) => s + p.lat, 0) / group.length;
        const lng = group.reduce((s, p) => s + p.lng, 0) / group.length;
        const color = group[0].color ?? sportColor(normalizeSport(group[0].sport));
        const icon = L.divIcon({
          className: "",
          html: `
            <div style="
              width:34px;height:34px;border-radius:50%;
              background:${color};color:#fff;
              display:flex;align-items:center;justify-content:center;
              font-weight:800;font-size:13px;font-family:'Inter',sans-serif;
              box-shadow:0 2px 14px rgba(0,0,0,0.55);border:2px solid rgba(255,255,255,0.85);
            ">${group.length}</div>
          `,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });
        const marker = L.marker([lat, lng], { icon });
        marker.on("click", () => {
          const bounds = L.latLngBounds(group.map((p) => [p.lat, p.lng] as [number, number]));
          // Every pin in the cluster sits on (near enough) the same point —
          // fitBounds has nothing to zoom into, so step in manually instead.
          if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
            map.setView(bounds.getCenter(), Math.min(map.getZoom() + 3, 18));
          } else {
            map.fitBounds(bounds.pad(0.3));
          }
        });
        return marker;
      }

      const CLUSTER_PX = 42;
      function groupByPixel(): MapPin[][] {
        const clusters: { pt: import("leaflet").Point; items: MapPin[] }[] = [];
        for (const pin of pins) {
          const pt = map.latLngToContainerPoint([pin.lat, pin.lng]);
          const near = clusters.find((c) => c.pt.distanceTo(pt) <= CLUSTER_PX);
          if (near) near.items.push(pin);
          else clusters.push({ pt, items: [pin] });
        }
        return clusters.map((c) => c.items);
      }

      const pinsLayer = L.layerGroup().addTo(map);
      function renderPins() {
        pinsLayer.clearLayers();
        for (const group of groupByPixel()) {
          (group.length === 1 ? pinMarker(group[0]) : clusterMarker(group)).addTo(pinsLayer);
        }
      }
      renderPins();
      // Pixel positions (and so which pins overlap) shift with every pan
      // and zoom — recompute clusters each time instead of only once.
      map.on("zoomend", renderPins);
      map.on("moveend", renderPins);

      // Pick mode
      if (pickMode) {
        map.on("click", (e) => {
          const { lat, lng } = e.latlng;
          setPicked([lat, lng]);
          onPick?.(lat, lng);

          // Move or add pick marker
          if ((map as unknown as { _pickMarker?: import("leaflet").Marker })._pickMarker) {
            (map as unknown as { _pickMarker: import("leaflet").Marker })._pickMarker.setLatLng([lat, lng]);
          } else {
            const pickIcon = L.divIcon({
              className: "",
              html: `<div style="width:14px;height:14px;border-radius:50%;background:#006241;border:3px solid #fff;box-shadow:0 0 0 3px rgba(0,98,65,0.4);"></div>`,
              iconAnchor: [7, 7],
            });
            (map as unknown as { _pickMarker: import("leaflet").Marker })._pickMarker =
              L.marker([lat, lng], { icon: pickIcon }).addTo(map);
          }
        });
      }

      mapRef.current = map;
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      if (el) {
        (el as HTMLElement & { _leafletClaimed?: boolean })._leafletClaimed = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update center if prop changes after mount
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setView(center, zoom);
    }
  }, [center, zoom]);

  return (
    <div style={{ position: "relative", height, borderRadius, overflow: "hidden" }}>
      {/* Leaflet CSS */}
      <style>{`
        @import url("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
        .leaflet-container { background: #e8eef3 !important; }
        .leaflet-tile-pane { filter: saturate(1.05); }
        .leaflet-control-attribution { background: rgba(255,255,255,0.75) !important; color: #64748b !important; font-size: 10px !important; }
        .leaflet-control-attribution a { color: #64748b !important; }
        .leaflet-control-zoom a { background: #ffffff !important; color: #14171E !important; border-color: rgba(20,23,30,0.12) !important; }
        .leaflet-control-zoom a:hover { background: #f1f5f9 !important; }
        .leaflet-popup-content-wrapper { background: #ffffff !important; border-radius: 12px !important; box-shadow: 0 8px 28px rgba(0,0,0,0.18) !important; }
        .leaflet-popup-tip { background: #ffffff !important; }
      `}</style>

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Pick mode helper */}
      {pickMode && (
        <div style={{
          position: "absolute", bottom: "12px", left: "50%", transform: "translateX(-50%)",
          background: "rgba(11,13,17,0.85)", backdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.1)", borderRadius: "100px",
          padding: "6px 16px", fontSize: "12px", fontWeight: 600,
          color: picked ? "#dff9ba" : "#F2EDE6", fontFamily: "'Inter',sans-serif",
          zIndex: 1000, pointerEvents: "none", whiteSpace: "nowrap" as const,
        }}>
          {picked
            ? `📍 ${picked[0].toFixed(5)}, ${picked[1].toFixed(5)}`
            : "Click anywhere to drop a pin"}
        </div>
      )}
    </div>
  );
}
