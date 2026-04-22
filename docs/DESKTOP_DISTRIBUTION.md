# Desktop distribution

`Dice Of The Damned` ships identical builds to every channel — web HTML5 on itch.io, plus native Mac and Windows desktop downloads. Hot-seat multiplayer (up to 4 players on one device) is always on.

## Channels

| Channel          | Build target             | Audience         |
| ---------------- | ------------------------ | ---------------- |
| itch.io HTML5    | `dist/creep-labyrinth-itch.zip` | Browser, no install |
| Mac (universal)  | `dist/desktop/Dice Of The Damned-<ver>-mac-universal.zip` | x86-64 + Apple Silicon |
| Windows (portable) | `dist/desktop/Dice Of The Damned-<ver>-win-x64-portable.exe` | x64, no installer |

All three are **free** downloads. The earlier "Party Edition" split (paid, multiplayer-gated) has been retired — everyone gets hot-seat.

---

## Build commands

### HTML5 (itch.io)

```bash
npm run build:itch
npm run package:itch          # → dist/creep-labyrinth-itch.zip
```

### Desktop

```bash
# Single-platform builds
npm run dist:mac              # → dist/desktop/Dice Of The Damned-<ver>-mac-universal.zip
npm run dist:win              # → dist/desktop/Dice Of The Damned-<ver>-win-x64-portable.exe

# Both platforms in one shot (also rebuilds out/)
npm run dist:desktop
```

`dist:mac` / `dist:win` assume `out/` is already up to date. If you've been editing game code, run `npm run build:itch` first, or use `npm run dist:desktop` which rebuilds `out/` before packaging.

---

## itch.io upload matrix

| File                                                              | Type       | Visibility   | Platform tag |
| ----------------------------------------------------------------- | ---------- | ------------ | ------------ |
| `creep-labyrinth-itch.zip`                                        | HTML       | Public, free | Web          |
| `Dice Of The Damned-<ver>-mac-universal.zip`                      | Mac        | Public, free | macOS        |
| `Dice Of The Damned-<ver>-win-x64-portable.exe`                   | Windows    | Public, free | Windows      |

No "available after purchase" flag on any of them — all three are free.

---

## First-launch notes for players

### macOS

The `.zip` contains `Dice Of The Damned.app`. The build is unsigned (indie convention on itch), so on first launch:

1. **Right-click** the app → **Open** (not double-click).
2. Gatekeeper will show a warning; click **Open** once to trust the app.
3. Subsequent launches work normally from the Dock / Applications.

### Windows

The `.exe` is a **portable** self-extracting build — no installer, no admin rights needed. Just double-click to run. SmartScreen may show a "Publisher unknown" warning on first launch; click **More info → Run anyway**.

---

## Architecture notes (for future maintainers)

### Multiplayer gate

The `MULTIPLAYER_ENABLED` constant in `lib/gameEnv.ts` is a compile-time `true`. It was briefly wired to `NEXT_PUBLIC_MULTIPLAYER_ENABLED` during the paid-Party-Edition exploration; that gating was removed and all call-sites now treat it as always-on. The constant is retained purely for grep-ability — every `if (MULTIPLAYER_ENABLED)` branch is a lightweight guard against future regressions (e.g. if we ever re-introduce a restricted build).

The **player count cap** is controlled by `MAX_PLAYERS` (also in `lib/gameEnv.ts`), currently `4` — matching the 4 hero portraits in `public/heroes/`. If you bump `MAX_PLAYERS`, add matching portraits under `public/heroes/hero-wear-<n>.png` and extend `HORROR_HERO_PORTRAITS` in `components/LabyrinthGame.tsx`.

### Why Electron, not Tauri

- Game uses advanced WebGL features (react-three-fiber, dice-box-threejs) that Tauri's WebView2/WKWebView don't implement consistently. Chromium-via-Electron matches the browser bundle one-for-one.
- `out/` is `asarUnpack`ed so Chromium streams GLBs directly from disk — same cold-start profile as the HTML5 build.
- Ship size is bounded by the `out/` tree (~300 MB of models/textures), not Electron itself (~80 MB). Wrapper swap would save <20%.

### Disk space for the universal mac build

`electron-builder --mac --universal` temporarily needs ~2 GB of scratch space during the lipo + ASAR steps. Keep `dist/desktop/` pruned between builds if you're tight on disk. Electron-builder 24.x has a known `ENOTEMPTY` cleanup bug after successful universal builds — the `.app` bundle itself is fine, just `rm -rf dist/desktop/mac-universal-*-temp` and re-zip with `ditto` if needed.
