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

type LogoChoice = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

function resolveLogo(pathname: string | null | undefined): LogoChoice {
  const path = pathname ?? "/";
  if (path.startsWith("/games/poker")) {
    return {
      src: "/assets/images/texas-holdem-logo.png",
      alt: "Dak & Chog Poker",
      width: 220,
      height: 120,
    };
  }
  if (path.startsWith("/games/blackjack")) {
    return {
      src: "/assets/images/blackjack-logo.png",
      alt: "Dak & Chog Blackjack",
      width: 220,
      height: 120,
    };
  }
  if (path.startsWith("/games/shell")) {
    return {
      src: "/assets/images/shell-game-logo.png",
      alt: "Shell Game",
      width: 220,
      height: 120,
    };
  }
  if (path.startsWith("/games/hazard")) {
    return {
      src: "/assets/images/hazard-logo.png",
      alt: "Hazard",
      width: 220,
      height: 120,
    };
  }
  if (path.startsWith("/games/dakchog")) {
    return {
      src: "/assets/images/dakandchog-logo.png",
      alt: "Dak & Chog Coin Flip",
      width: 220,
      height: 120,
    };
  }
  return {
    src: "/assets/images/d-and-c-logo.png",
    alt: "The Dak & Chog Tavern",
    width: 180,
    height: 80,
  };
}

export const AppNav = () => {
  const pathname = usePathname();
  const { address } = useWallet();
  const [collapsed, setCollapsed] = useState(false);
  const logo = useMemo(() => resolveLogo(pathname), [pathname]);

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
        <Image src={logo.src} alt={logo.alt} width={logo.width} height={logo.height} priority />
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
