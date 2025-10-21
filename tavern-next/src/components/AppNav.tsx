'use client';

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { ADMIN_ADDRESS } from "@/lib/config";
import { useWallet } from "@/context/WalletContext";

type NavItem = {
  label: string;
  href: string;
  exact?: boolean;
};

export const AppNav = () => {
  const pathname = usePathname();
  const { address } = useWallet();
  const [collapsed, setCollapsed] = useState(false);

  const navItems = useMemo<NavItem[]>(() => {
    const base: NavItem[] = [
      { label: "Home", href: "/" },
      { label: "Poker", href: "/games/poker" },
      { label: "Hazard", href: "/games/hazard" },
      { label: "Shell Game", href: "/games/shell" },
      { label: "Dak & Chog", href: "/games/dakchog" },
      { label: "Blackjack", href: "/games/blackjack" },
      { label: "Rules", href: "/rules" },
    ];
    const isOwner =
      ADMIN_ADDRESS && address && address.toLowerCase() === ADMIN_ADDRESS.toLowerCase();
    if (isOwner) {
      base.push({ label: "Admin", href: "/admin" });
    }
    return base;
  }, [address]);

  const items = useMemo(() => {
    return navItems.map((item) => {
      const active = item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
      return { ...item, active };
    });
  }, [pathname, navItems]);

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-label="Main navigation">
      <button
        className="sidebar-toggle"
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
      >
        {collapsed ? "Menu" : "Close"}
      </button>

      <Link className="sidebar-logo" href="/">
        <Image src="/assets/images/d-and-c-logo.png" alt="Dak & Chog Tavern" width={180} height={80} priority />
      </Link>

      <ul className="sidebar-links">
        {items.map(({ label, href, active }) => (
          <li key={href}>
            <Link className={active ? "active" : undefined} href={href}>
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
};
