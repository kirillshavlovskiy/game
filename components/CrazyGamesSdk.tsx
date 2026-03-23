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
 *
 * Before `init()`, `SDK.environment` is `"uninitialized"`. After `init()`, it becomes `"local"`,
 * `"crazygames"`, or `"disabled"`. On hosts that are not localhost / 127.0.0.1 / CrazyGames,
 * the SDK is disabled — calling `game.*` then throws (often mistaken for "401"). We only
 * call `game.loadingStart` / `gameplayStart` when not disabled. For LAN or custom hostnames,
 * open the game with `?useLocalSdk=true` or use http://127.0.0.1 — see CrazyGames HTML5 docs.
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
      if (!sdk || typeof sdk.init !== "function") {
        attempt += 1;
        if (attempt < maxAttempts) {
          window.setTimeout(tryBootstrap, 100);
        }
        return;
      }

      cgsdkBootstrapStarted = true;

      (async () => {
        try {
          await sdk.init();
          if (cancelled) return;

          const env = sdk.environment;
          if (env === "disabled") {
            console.info(
              "[CrazyGames] SDK is disabled on this origin. Use http://localhost or http://127.0.0.1, " +
                "add ?useLocalSdk=true to the URL, or test on crazygames.com / the developer preview."
            );
            return;
          }

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
