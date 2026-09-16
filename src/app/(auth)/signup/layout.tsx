import type { Metadata } from "next";

// signup/page.tsx is a client component, which can't export `metadata`
// directly — this layout exists purely to give the route its own title
// instead of inheriting the homepage's generic one.
export const metadata: Metadata = {
  title: "Sign up — Sportonica",
  description: "Create your account to book courts, join pickup games, and find your regular crew.",
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
