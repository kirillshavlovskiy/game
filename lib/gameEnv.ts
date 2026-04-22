/**
 * Build-time / client bundle flags.
 *
 * Hot-seat multiplayer (up to 4 players) is a standard feature of the game
 * and is always available in production builds. This constant is kept for
 * grep-ability and to document every call-site that branches on the MP toggle
 * — every such site can be treated as a compile-time `true`.
 *
 * Historical note: this used to be gated by `NEXT_PUBLIC_MULTIPLAYER_ENABLED`
 * when we considered a paid "Party Edition" SKU. The gate was dropped in
 * favor of shipping MP in every build (free HTML5 + desktop alike).
 */
export const MULTIPLAYER_ENABLED = true as const;

/** Maximum concurrent human players in a single hot-seat session. */
export const MAX_PLAYERS = 4;
