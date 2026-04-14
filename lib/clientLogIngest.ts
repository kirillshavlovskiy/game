/**
 * Send structured events to `/api/client-log` for server-side crash / error diagnostics.
 *
 * Enable reporting:
 * - Set `NEXT_PUBLIC_CLIENT_LOG_INGEST=1` in `.env` (and production env).
 * - Production: set `CLIENT_LOG_INGEST_SECRET` on the server and the same value in
 *   `NEXT_PUBLIC_CLIENT_LOG_INGEST_SECRET`, unless you use `CLIENT_LOG_ALLOW_ANONYMOUS_PROD=1` (abuse risk).
 */

export type ClientLogLevel = "crash" | "error" | "warn" | "info" | "debug";

export type ClientLogPayload = {
  level: ClientLogLevel;
  message: string;
  /** Short tag, e.g. "unhandledrejection", "combat", "webgl" */
  event?: string;
  stack?: string;
  context?: Record<string, unknown>;
  url?: string;
  clientTs?: number;
  sessionId?: string;
  referrer?: string;
};

const PATH = "/api/client-log";

function ingestEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_CLIENT_LOG_INGEST === "1"
  );
}

function secretHeaders(): HeadersInit {
  const s = process.env.NEXT_PUBLIC_CLIENT_LOG_INGEST_SECRET?.trim();
  if (!s) return {};
  return { "x-client-log-secret": s };
}

function sessionId(): string {
  try {
    const k = "clientLogSessionId";
    let id = sessionStorage.getItem(k);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      sessionStorage.setItem(k, id);
    }
    return id;
  } catch {
    return "no-session";
  }
}

function defaultPayload(): Pick<ClientLogPayload, "url" | "clientTs" | "referrer" | "sessionId"> {
  return {
    url: typeof window !== "undefined" ? window.location.href : undefined,
    referrer: typeof document !== "undefined" ? document.referrer || undefined : undefined,
    clientTs: Date.now(),
    sessionId: sessionId(),
  };
}

/**
 * Report an error or custom diagnostic event. Fire-and-forget; never throws to callers.
 */
export function reportClientLog(payload: ClientLogPayload): void {
  if (!ingestEnabled()) return;
  const body: ClientLogPayload = {
    ...defaultPayload(),
    ...payload,
  };
  const json = JSON.stringify(body);
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...secretHeaders(),
  };

  const needsAuthHeaders = Boolean(process.env.NEXT_PUBLIC_CLIENT_LOG_INGEST_SECRET?.trim());
  /* sendBeacon cannot attach custom headers — skip it when a shared secret is required. */
  if (!needsAuthHeaders) {
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([json], { type: "application/json" });
        if (navigator.sendBeacon(PATH, blob)) return;
      }
    } catch {
      /* fall through to fetch */
    }
  }

  void fetch(PATH, {
    method: "POST",
    headers,
    body: json,
    keepalive: true,
  }).catch(() => {});
}

function stringifyReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name || "Error";
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function stackFrom(reason: unknown): string | undefined {
  if (reason instanceof Error && reason.stack) return reason.stack;
  return undefined;
}

/** Global handlers + optional React error reporting. Idempotent. */
let installed = false;

export function initClientLogIngest(): void {
  if (typeof window === "undefined" || installed) return;
  if (!ingestEnabled()) return;
  installed = true;

  window.addEventListener(
    "error",
    (ev: ErrorEvent) => {
      reportClientLog({
        level: "crash",
        event: "window.error",
        message: ev.message || "window.error",
        stack: ev.error instanceof Error ? ev.error.stack : `${ev.filename}:${ev.lineno}:${ev.colno}`,
        context: { filename: ev.filename, lineno: ev.lineno, colno: ev.colno },
      });
    },
    true,
  );

  window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    reportClientLog({
      level: "error",
      event: "unhandledrejection",
      message: stringifyReason(reason),
      stack: stackFrom(reason),
    });
  });
}

/**
 * Explicit crash breadcrumb from game code (combat, WebGL loss, etc.).
 */
export function reportClientEvent(
  event: string,
  message: string,
  level: ClientLogLevel = "info",
  context?: Record<string, unknown>,
): void {
  reportClientLog({ level, event, message, context });
}
