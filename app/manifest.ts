import type { MetadataRoute } from "next";

/** Lets users “Add to Home Screen” on iPhone/iPad and open without Safari’s tab bar (`display: standalone`). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dice Of The Damned",
    short_name: "DOTD",
    description: "3D dice maze game",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#0a0a0f",
    orientation: "any",
    icons: [
      {
        src: "/covers/dice-of-the-damned-square-800x800.png",
        sizes: "800x800",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/covers/dice-of-the-damned-square-800x800.png",
        sizes: "800x800",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
