import type { Metadata } from "next";

// notifications/page.tsx is a client component, which can't export
// `metadata` directly — this layout exists purely to give the route its
// own title instead of inheriting the homepage's generic one.
export const metadata: Metadata = {
  title: "Notifications — Sportonica",
  description: "Bookings, payments, tournaments and social updates in one place.",
};

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
