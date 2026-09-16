import type { Metadata } from "next";

// forgot-password/page.tsx is a client component, which can't export
// `metadata` directly — this layout exists purely to give the route its
// own title instead of inheriting the homepage's generic one.
export const metadata: Metadata = {
  title: "Reset your password — Sportonica",
  description: "Get a password reset link sent to your email.",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
