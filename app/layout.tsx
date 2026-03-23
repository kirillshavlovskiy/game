import type { Metadata } from "next";
import Script from "next/script";
import "@fontsource/creepster";
import { CrazyGamesSdk } from "@/components/CrazyGamesSdk";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creep Labyrinth",
  description: "Creep Labyrinth - 3D dice maze game",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/**
         * Vendored from https://sdk.crazygames.com/crazygames-sdk-v3.js — same-origin load avoids
         * portal CSP / missing-resource warnings when the CDN is blocked for the iframe.
         * Re-download when upgrading: curl -fsSL "https://sdk.crazygames.com/crazygames-sdk-v3.js" -o public/crazygames-sdk-v3.js
         */}
        <Script src="crazygames-sdk-v3.js" strategy="beforeInteractive" />
      </head>
      <body>
        <CrazyGamesSdk />
        {children}
      </body>
    </html>
  );
}
