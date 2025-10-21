import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "../context/WalletContext";
import { WalletInline } from "../components/WalletInline";
import { FooterMeta } from "../components/FooterMeta";
import { BankrollWidget } from "../components/BankrollWidget";
import { AppNav } from "../components/AppNav";
import Script from "next/script";

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
          <BankrollWidget />
          <AppNav />
          <div className="content-frame">{children}</div>
          <FooterMeta />
        </WalletProvider>
        <Script id="tavern-build-tag" strategy="beforeInteractive">
          {`window.__BUILD_TAG = window.__BUILD_TAG || '${Date.now()}';`}
        </Script>
      </body>
    </html>
  );
}
