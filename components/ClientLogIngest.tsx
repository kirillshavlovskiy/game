"use client";

import { useEffect } from "react";
import { initClientLogIngest } from "@/lib/clientLogIngest";

/**
 * Mount once in root layout: registers `error` / `unhandledrejection` → `/api/client-log`
 * when `NEXT_PUBLIC_CLIENT_LOG_INGEST=1` or in development.
 */
export function ClientLogIngest() {
  useEffect(() => {
    initClientLogIngest();
  }, []);
  return null;
}
