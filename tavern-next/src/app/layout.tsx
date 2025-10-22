import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "../context/WalletContext";
import { WalletInline } from "../components/WalletInline";
import { FooterMeta } from "../components/FooterMeta";
import { AppNav } from "../components/AppNav";
import Script from "next/script";

const LEGACY_IMPORT_MAP = {
  imports: {
    viem: "https://esm.sh/viem@2.31.4?target=es2020&bundle",
    "viem/account-abstraction":
      "https://esm.sh/viem@2.31.4/account-abstraction?target=es2020&bundle",
    "@metamask/delegation-abis":
      "https://esm.sh/@metamask/delegation-abis@0.13.0?target=es2020&bundle",
    "@metamask/providers":
      "https://esm.sh/@metamask/providers@12.1.0?target=es2020&bundle",
  },
};

export const metadata: Metadata = {
  title: "The Dak & Chog Tavern",
  description:
    "The Taverns of Dak & Chog - multiplayer cards, banked AA gameplay, and on-chain fun.",
  icons: {
    icon: "/assets/images/d-and-c-logo.png",
    shortcut: "/assets/images/d-and-c-logo.png",
    apple: "/assets/images/d-and-c-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="home">
        <WalletProvider>
          <WalletInline />
          <AppNav />
          <div className="content-frame">{children}</div>
          <FooterMeta />
        </WalletProvider>
        <Script
          id="ethers-umd"
          src="https://cdn.jsdelivr.net/npm/ethers@6.15.0/dist/ethers.umd.min.js"
          strategy="beforeInteractive"
        />
        <Script id="aa-import-map" strategy="beforeInteractive" type="importmap">
          {JSON.stringify(LEGACY_IMPORT_MAP)}
        </Script>
        <Script id="bankroll-script" src="/js/bankroll.js" strategy="afterInteractive" />
        <Script id="wallet-sync-script" src="/js/wallet-sync.js" strategy="afterInteractive" />
        <Script id="wallet-chips-script" src="/js/wallet-chips.js" strategy="afterInteractive" />
        <Script id="tavern-build-tag" strategy="beforeInteractive">
          {`window.__BUILD_TAG = window.__BUILD_TAG || '${Date.now()}';`}
        </Script>
      </body>
    </html>
  );
}
