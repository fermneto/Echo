import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="Echo, início">
      echo<span className="logo__dot" aria-hidden="true" />
    </Link>
  );
}
