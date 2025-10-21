'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

type NavItem = {
  label: string;
  href: string;
  exact?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Poker", href: "/games/poker" },
  { label: "Hazard", href: "/games/hazard" },
  { label: "Shell Game", href: "/games/shell" },
  { label: "Dak & Chog", href: "/games/dakchog" },
  { label: "Blackjack", href: "/games/blackjack" },
  { label: "Rules", href: "/rules" },
];

export const AppNav = () => {
  const pathname = usePathname();

  const items = useMemo(() => {
    return NAV_ITEMS.map((item) => {
      const active = item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
      return { ...item, active };
    });
  }, [pathname]);

  return (
    <nav className="app-nav" aria-label="Main navigation">
      <ul>
        {items.map(({ label, href, active }) => (
          <li key={href}>
            <Link className={active ? "active" : undefined} href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};
