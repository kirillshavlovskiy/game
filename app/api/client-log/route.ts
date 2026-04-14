/**
 * Ingest client-reported errors / crashes for server-side logging (stdout + optional JSONL file).
 *
 * Configure (production):
 * - `CLIENT_LOG_INGEST_SECRET` — required unless `CLIENT_LOG_ALLOW_ANONYMOUS_PROD=1`. Client must send the same value
 *   in `x-client-log-secret` or `Authorization: Bearer <secret>`. For browser builds also set
 *   `NEXT_PUBLIC_CLIENT_LOG_INGEST_SECRET` (same string).
 * - `NEXT_PUBLIC_CLIENT_LOG_INGEST=1` — enable the client reporter (see `components/ClientLogIngest.tsx`).
 *
 * Development: accepts logs without a secret when `NODE_ENV !== "production"`.
 *
 * Optional: `CLIENT_LOG_FILE` — append one JSON line per event (works with `next start` on a writable disk; not on typical serverless FS).
 */
import { appendFile } from "node:fs/promises";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 48_000;

function authOk(request: Request): { ok: boolean; reason?: string } {
  const isProd = process.env.NODE_ENV === "production";
  const secret = process.env.CLIENT_LOG_INGEST_SECRET?.trim();
  const allowAnon = process.env.CLIENT_LOG_ALLOW_ANONYMOUS_PROD === "1";

  if (!isProd) {
    if (!secret) return { ok: true };
    return headerMatchesSecret(request, secret) ? { ok: true } : { ok: false, reason: "bad_secret" };
  }

  if (allowAnon && !secret) return { ok: true };
  if (!secret) return { ok: false, reason: "ingest_not_configured" };
  return headerMatchesSecret(request, secret) ? { ok: true } : { ok: false, reason: "bad_secret" };
}

function headerMatchesSecret(request: Request, secret: string): boolean {
  const h = request.headers.get("x-client-log-secret");
  if (h === secret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

function clampStr(s: unknown, max: number): string | undefined {
  if (typeof s !== "string") return undefined;
  return s.length <= max ? s : s.slice(0, max);
}

export async function POST(request: Request) {
  const auth = authOk(request);
  if (!auth.ok) {
    const status = auth.reason === "ingest_not_configured" ? 503 : 401;
    return Response.json(
      { ok: false, error: auth.reason ?? "unauthorized" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const o = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};

  const levelRaw = typeof o.level === "string" ? o.level : "info";
  const level = ["error", "warn", "info", "crash", "debug"].includes(levelRaw) ? levelRaw : "info";

  const entry = {
    kind: "client-log" as const,
    ts: new Date().toISOString(),
    level,
    event: clampStr(o.event, 128),
    message: clampStr(o.message, 8000) ?? "(no message)",
    stack: clampStr(o.stack, 24_000),
    context:
      o.context != null && typeof o.context === "object" && !Array.isArray(o.context)
        ? sanitizeContext(o.context as Record<string, unknown>)
        : undefined,
    url: clampStr(o.url, 2000),
    clientTs: typeof o.clientTs === "number" && Number.isFinite(o.clientTs) ? o.clientTs : undefined,
    sessionId: clampStr(o.sessionId, 80),
    referrer: clampStr(o.referrer, 2000),
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      undefined,
    ua: clampStr(request.headers.get("user-agent"), 600),
  };

  console.log(`[client-log] ${JSON.stringify(entry)}`);

  const logPath = process.env.CLIENT_LOG_FILE?.trim();
  if (logPath) {
    try {
      await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch (e) {
      console.error("[client-log] CLIENT_LOG_FILE append failed:", e);
    }
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

/** Drop functions/symbols; shallow stringify nested objects; cap entries. */
function sanitizeContext(ctx: Record<string, unknown>, maxKeys = 40): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(ctx)) {
    if (n >= maxKeys) {
      out["_truncated"] = true;
      break;
    }
    const key = k.slice(0, 64);
    if (typeof v === "string") out[key] = v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
    else if (v === null) out[key] = null;
    else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      try {
        out[key] = JSON.parse(JSON.stringify(v));
      } catch {
        out[key] = "[unserializable]";
      }
    } else {
      try {
        out[key] = JSON.stringify(v).slice(0, 500);
      } catch {
        out[key] = "[unserializable]";
      }
    }
    n++;
  }
  return out;
}
