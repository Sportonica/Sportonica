import type { Metadata } from "next";

// reset-password/page.tsx is a client component, which can't export
// `metadata` directly — this layout exists purely to give the route its
// own title instead of inheriting the homepage's generic one.
export const metadata: Metadata = {
  title: "Set a new password — Sportonica",
  description: "Choose a new password for your Sportonica account.",
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
