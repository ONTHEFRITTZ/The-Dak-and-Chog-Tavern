import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "../context/WalletContext";
import { WalletInline } from "../components/WalletInline";
import { FooterMeta } from "../components/FooterMeta";
import { AppNav } from "../components/AppNav";
import Script from "next/script";

const AA_IMPORT_MAP = {
  imports: {
    viem: "https://esm.sh/viem@2.8.6?bundle",
    "viem/account-abstraction": "https://esm.sh/viem@2.8.6/account-abstraction?bundle",
    "@metamask/delegation-abis":
      "https://cdn.jsdelivr.net/npm/@metamask/delegation-abis@0.13.0/dist/index.js",
    "@metamask/providers":
      "https://cdn.jsdelivr.net/npm/@metamask/providers@12.1.0/dist/index.js",
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
        <Script id="aa-import-map" strategy="beforeInteractive" type="importmap">
          {JSON.stringify(AA_IMPORT_MAP)}
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
