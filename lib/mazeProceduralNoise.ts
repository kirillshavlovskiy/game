import { createNoise2D } from "simplex-noise";

const SIZE = 256;

/**
 * Builds a tileable-ish grayscale noise data URL and sets `--maze-simplex-noise` on the element
 * for use in CSS (e.g. `.maze-wrap::after { background-image: var(--maze-simplex-noise, …); }`).
 * Skips work when `prefers-reduced-motion: reduce` (static PNG fallback in CSS).
 */
export function applyMazeSimplexNoiseToElement(el: HTMLElement | null): void {
  if (!el || typeof document === "undefined") return;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch {
    /* ignore */
  }

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const noise2D = createNoise2D();
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  const scale = 0.06;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = (noise2D(x * scale, y * scale) + 1) * 0.5;
      const g = Math.floor(v * 220 + 20);
      const a = Math.floor(28 + v * 55);
      const i = (y * SIZE + x) * 4;
      d[i] = g;
      d[i + 1] = g;
      d[i + 2] = g;
      d[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/png");
  el.style.setProperty("--maze-simplex-noise", `url("${url}")`);
}
