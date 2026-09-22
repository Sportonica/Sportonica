"use client";

import { useState } from "react";
import Link from "next/link";
import "../../(play)/play.css";
import { submitContactForm } from "@/lib/mail/contactActions";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await submitContactForm({ name, email, subject, message });
      if (!res.ok) {
        setErr(res.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setErr("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="play has-sitenav">
      <div className="play-wrap" style={{ maxWidth: 640 }}>
        <div className="bk-panel">
          <h1 style={{ fontSize: 28, marginBottom: 6 }}>Contact us</h1>
          <p className="hint" style={{ marginBottom: 28 }}>
            Questions, feedback, or something not working right? Send us a note and we&apos;ll get
            back to you. You can also reach us directly at{" "}
            <a href="mailto:info@sportonica.com" style={{ color: "var(--sodium)", textDecoration: "underline", textUnderlineOffset: 2 }}>
              info@sportonica.com
            </a>{" "}
            or{" "}
            <a href="tel:+9779714593865" style={{ color: "var(--sodium)", textDecoration: "underline", textUnderlineOffset: 2 }}>
              +977 971-459-3865
            </a>
            .
          </p>

          {sent ? (
            <div
              style={{
                background: "rgba(0,98,65,0.1)",
                border: "1px solid rgba(0,98,65,0.3)",
                borderRadius: 12,
                padding: "20px 20px",
                fontSize: 14.5,
                lineHeight: 1.6,
                color: "inherit",
              }}
            >
              <b style={{ color: "var(--sodium)" }}>Message sent.</b> Thanks for reaching out. We
              usually reply within a day or two.
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <Field label="Name">
                <input
                  className="bk-in"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  required
                />
              </Field>

              <Field label="Email">
                <input
                  className="bk-in"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </Field>

              <Field label="Subject">
                <input
                  className="bk-in"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What's this about?"
                />
              </Field>

              <Field label="Message">
                <textarea
                  className="bk-note"
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what's up..."
                  required
                />
              </Field>

              {err && (
                <p style={{ color: "#e05d5d", fontSize: 13, marginBottom: 16 }}>{err}</p>
              )}

              <button type="submit" className="play-btn gold" disabled={busy}>
                {busy ? "Sending…" : "Send message"}
              </button>
            </form>
          )}

          <p className="hint legal-foot" style={{ marginTop: 28 }}>
            <Link href="/">← Back to Sportonica</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 6, color: "var(--dim)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
