import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Echo, início">
      echo<span className="logo__dot">.</span>
    </Link>
  );
}
