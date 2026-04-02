/**
 * Opt-in tracing for minimap / 3D orbit / bearing pipeline.
 *
 * Enable (any one):
 *   window.__DEBUG_MAP_ROTATION__ = true
 *   localStorage.setItem('DEBUG_MAP_ROTATION','1'); location.reload()
 *
 * Filter console by: mapRotation
 *
 * Disable: window.__DEBUG_MAP_ROTATION__ = false (and remove localStorage key)
 */

export function mapRotationDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __DEBUG_MAP_ROTATION__?: boolean };
  if (w.__DEBUG_MAP_ROTATION__ === true) return true;
  try {
    if (localStorage.getItem("DEBUG_MAP_ROTATION") === "1") return true;
  } catch {
    /* private mode */
  }
  return false;
}

let hintShown = false;

/** Call once on app load (dev) so device emulation users see how to turn logs on. */
export function mapRotationDebugHint(): void {
  if (typeof window === "undefined" || hintShown) return;
  if (process.env.NODE_ENV !== "development") return;
  hintShown = true;
  console.info(
    "[mapRotation] Logs off by default. Enable: window.__DEBUG_MAP_ROTATION__=true OR localStorage.setItem('DEBUG_MAP_ROTATION','1') then reload. Filter: mapRotation",
  );
}

const throttleAt = new Map<string, number>();

export function mapRotationLog(
  tag: string,
  data?: Record<string, unknown>,
  throttleMs = 0,
): void {
  if (!mapRotationDebugEnabled()) return;
  if (throttleMs > 0) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const last = throttleAt.get(tag) ?? 0;
    if (now - last < throttleMs) return;
    throttleAt.set(tag, now);
  }
  if (data !== undefined) console.log(`[mapRotation] ${tag}`, data);
  else console.log(`[mapRotation] ${tag}`);
}

const snapshotJson = new Map<string, string>();

/** Inside hot paths (e.g. useFrame): log only when serialized payload changes. */
export function mapRotationLogSnapshot(tag: string, payload: Record<string, unknown>): void {
  if (!mapRotationDebugEnabled()) return;
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    json = String(payload);
  }
  if (snapshotJson.get(tag) === json) return;
  snapshotJson.set(tag, json);
  console.log(`[mapRotation] ${tag}`, payload);
}
