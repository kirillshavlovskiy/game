import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Labyrinth - Maze Game",
  description: "3D dice labyrinth maze game",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
