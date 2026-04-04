/**
 * Build-time / client bundle flags from `NEXT_PUBLIC_*` env vars.
 *
 * Set `NEXT_PUBLIC_MULTIPLAYER_ENABLED=true` in `.env.local` to allow changing the player count
 * (2–10) from the start menu. When unset or false, the UI hides that control and the game uses
 * exactly one human player.
 */
export const MULTIPLAYER_ENABLED =
  typeof process.env.NEXT_PUBLIC_MULTIPLAYER_ENABLED === "string" &&
  ["true", "1", "yes"].includes(process.env.NEXT_PUBLIC_MULTIPLAYER_ENABLED.trim().toLowerCase());
