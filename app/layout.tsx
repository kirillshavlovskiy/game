import type { Metadata } from "next";
import { Creepster } from "next/font/google";
import "./globals.css";

const creepster = Creepster({ weight: "400", subsets: ["latin"] });

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
      <body className={creepster.className}>{children}</body>
    </html>
  );
}
