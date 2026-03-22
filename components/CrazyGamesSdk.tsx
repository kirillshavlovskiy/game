"use client";

import { useEffect } from "react";

let cgsdkBootstrapStarted = false;

function whenPageFullyLoaded(cb: () => void) {
  if (typeof document === "undefined") return;
  if (document.readyState === "complete") {
    queueMicrotask(cb);
    return;
  }
  window.addEventListener("load", () => cb(), { once: true });
}

/**
 * Loads and initializes the CrazyGames HTML5 v3 SDK, then reports loading and gameplay events.
 * Skips all calls when `environment === "disabled"` (e.g. Vercel or non-CrazyGames domains).
 */
export function CrazyGamesSdk() {
  useEffect(() => {
    if (cgsdkBootstrapStarted) return;

    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 40;

    const tryBootstrap = () => {
      if (cancelled || cgsdkBootstrapStarted) return;

      const sdk = window.CrazyGames?.SDK;
      if (!sdk) {
        attempt += 1;
        if (attempt < maxAttempts) {
          window.setTimeout(tryBootstrap, 100);
        }
        return;
      }

      if (sdk.environment === "disabled") {
        cgsdkBootstrapStarted = true;
        return;
      }

      cgsdkBootstrapStarted = true;

      (async () => {
        try {
          await sdk.init();
          if (cancelled) return;
          sdk.game.loadingStart();
          whenPageFullyLoaded(() => {
            if (cancelled) return;
            try {
              sdk.game.loadingStop();
              sdk.game.gameplayStart();
            } catch (e) {
              console.warn("CrazyGames SDK (loading/gameplay):", e);
            }
          });
        } catch (e) {
          console.warn("CrazyGames SDK (init):", e);
        }
      })();
    };

    tryBootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
