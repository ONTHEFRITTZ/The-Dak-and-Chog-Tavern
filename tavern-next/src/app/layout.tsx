import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "../context/WalletContext";
import { WalletInline } from "../components/WalletInline";
import { FooterMeta } from "../components/FooterMeta";
import Script from "next/script";

export const metadata: Metadata = {
  title: "The Dak & Chog Tavern",
  description:
    "The Taverns of Dak & Chog - multiplayer cards, banked AA gameplay, and on-chain fun.",
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
          {children}
          <FooterMeta />
        </WalletProvider>
        <Script
          id="tavern-build-tag"
          strategy="beforeInteractive"
        >{`window.__BUILD_TAG = window.__BUILD_TAG || '${Date.now()}';`}</Script>
        <Script src="/js/aaClient.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
