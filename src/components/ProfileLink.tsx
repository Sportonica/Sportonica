import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// A link to a player's public profile.
//
// Players without a username have no profile page. Those used to render as
// `<a href="#">`, which screen readers announce as a link and which jumps to
// the top of the page when clicked, so they now render as plain content.
//
// Pass `label` when the link holds only an avatar: an image with empty alt
// text gives the link no accessible name on its own.
export default function ProfileLink({
  username,
  label,
  className,
  style,
  children,
}: {
  username?: string | null;
  label?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (!username) {
    return <span className={className} style={style}>{children}</span>;
  }
  return (
    <Link href={`/p/${username}`} className={className} style={style} aria-label={label}>
      {children}
    </Link>
  );
}
