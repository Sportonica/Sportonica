"use client";

// A burst of confetti when the page opens, then a lighter fall for a few
// seconds. Canvas, no library. Skipped for people who ask for less motion.

import { useEffect, useRef } from "react";

const COLORS = ["#006241", "#dff9ba", "#f5b301", "#ff5a5f", "#3d8a68", "#4f8cff", "#ffffff"];

interface Piece { x: number; y: number; vx: number; vy: number; size: number; color: string; spin: number; angle: number; shape: 0 | 1 }

export default function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const w = () => window.innerWidth, h = () => window.innerHeight;
    const pieces: Piece[] = [];
    const piece = (x: number, y: number, vx: number, vy: number): Piece => ({
      x, y, vx, vy, size: 6 + Math.random() * 7, color: COLORS[Math.floor(Math.random() * COLORS.length)],
      spin: (Math.random() - 0.5) * 0.3, angle: Math.random() * Math.PI, shape: Math.random() < 0.7 ? 0 : 1,
    });
    // two cannons from the bottom corners
    for (let i = 0; i < 140; i++) {
      const left = i % 2 === 0;
      pieces.push(piece(left ? 0 : w(), h(), (left ? 1 : -1) * (4 + Math.random() * 9), -(12 + Math.random() * 10)));
    }

    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = now - start;
      // a gentle fall from the top for the first few seconds
      if (t < 3500 && Math.random() < 0.6) pieces.push(piece(Math.random() * w(), -10, (Math.random() - 0.5) * 2, 1 + Math.random() * 2));
      ctx.clearRect(0, 0, w(), h());
      for (const p of pieces) {
        p.vy += 0.25; p.vx *= 0.99; p.vy = Math.min(p.vy, 6);
        p.x += p.vx + Math.sin((t + p.size * 100) / 300) * 0.6; p.y += p.vy; p.angle += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        if (p.shape === 0) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else { ctx.beginPath(); ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].y > h() + 20) pieces.splice(i, 1);
      if (pieces.length || t < 3500) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w(), h());
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={ref} aria-hidden="true" style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 50 }} />;
}
