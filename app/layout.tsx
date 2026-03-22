import type { Metadata } from "next";
import Script from "next/script";
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
        <Script
          src="https://sdk.crazygames.com/crazygames-sdk-v3.js"
          strategy="beforeInteractive"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Creepster&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <CrazyGamesSdk />
        {children}
      </body>
    </html>
  );
}
