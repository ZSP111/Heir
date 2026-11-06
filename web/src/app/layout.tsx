import type { Metadata, Viewport } from "next";

import { Header } from "@/components/Header";
import { WalletProvider } from "@/components/WalletProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Heir: crypto inheritance across chains",
  description:
    "A dead man's switch vault on NEAR. Check in now and then; if you go silent, your heirs inherit your NEAR and ETH.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <WalletProvider>
          <Header />
          <main className="mx-auto max-w-4xl px-4 py-8 sm:py-12">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
