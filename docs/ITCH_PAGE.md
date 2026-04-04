# Creep Labyrinth — itch.io page copy

Paste sections below into your itch.io **Edit game** page (description, “How to play,” etc.). Tweak line breaks if the editor wraps oddly.

---

## Short tagline (optional)

Retro horror maze crawl: **2D map or 3D view**, turn-based movement, **3D dice combat**, artifacts, and monsters that can end your run.

---

## Full description / “How to play”

**Creep Labyrinth** is a retro, horror-tinged maze game you can play **solo** or **hot-seat** with friends on one screen—keyboard, mouse, or touch.

### Single-player

Play as one explorer against the labyrinth: **roll for moves**, pick your route from start (**S**) to the exit (**X**), and survive traps, artifacts, and monsters. Use a **top-down 2D map** or switch to a **3D view** for immersion (including full-screen on supported devices). Combat uses **3D dice** and on-screen actions—manage **HP**, **shields**, and **artifacts**; some threats can knock you out of the run entirely, with a clear **game over** and option to **restart** for a fresh maze.

### Multiplayer (same screen)

For game nights or couch play, add more human players and **pass the device** (or share one keyboard): turns are **hot-seat**—only the active player moves, but everyone sees the same maze, combat, and dice.

### Goal

Reach the exit. The maze can hold **multiple routes at once** in multiplayer—you’re racing through shared corridors, not on separate devices. Solo, it’s you versus the layout and whatever’s inside it.

### Turns & movement

On your turn, move with **WASD** or **arrow keys**, or **tap** on touch. Plan around dead ends, fog, teleports, bombs, slingshots, and other players’ pawns blocking lines of sight.

### Combat

Fights are **turn-based** with **3D rolls**. Attack, defend, run, and use **skills and artifacts** where the UI allows—timing and HP often decide whether you push forward or limp back to recover.

### New runs

Start a **new random maze** anytime. Size and difficulty scale the session: quick crawls or longer, tougher labyrinths.

### Itch.io (HTML) build note

This upload is a **static HTML** build: **“Generate with AI”** needs a hosted API with keys; use **Random maze** (and in-game options) for full offline play.

### Why it works for groups

One screen keeps the table-talk energy of a **board-game night**—with a spooky maze and dice you can almost feel in 3D.

### Devices

- **Tablet / touch:** Great for tapping skills, dice, and UI; easy to pass around the couch.  
- **Phone:** Playable; smaller UI, best for shorter sessions.  
- **Laptop / PC:** **WASD / arrows** for precise movement; fine for desk play or one keyboard shared at a party.

### Content note

Mild **horror** atmosphere and monster encounters in a **DOS-style** look—spooky, not gore. **Teens and up** suggested; younger players with parental judgment.

---

## Version

Package version (see `package.json`): bump when you cut a new zip for itch.

---

## itch.io dashboard: Genre

Pick **one** primary genre from itch’s list. Best fit for Creep Labyrinth:

| Choice        | Why |
|---------------|-----|
| **Adventure** | **Recommended.** Core loop is exploring a labyrinth, uncovering the map, and surviving encounters—classic adventure framing. |
| Puzzle        | Strong if you want to stress **maze-solving** and route planning over combat. |
| Strategy      | Emphasizes **turn-based** movement and combat decisions. |
| Role Playing  | Fits if you highlight **HP, loot, artifacts, and dice combat** as the main hook. |

**Suggestion:** Set genre to **Adventure**, then use itch **Tags** (e.g. `horror`, `maze`, `turn-based`, `dice`, `retro`, `multiplayer`, `singleplayer`, `3D`, `procedural`) so search and collections still capture puzzle/strategy players.

---

## Release checklist

1. `npm run package:itch` → upload `dist/creep-labyrinth-itch.zip` as **HTML** (index at zip root).  
2. Match **version** in `package.json` to what you note in the itch devlog or file name if you rename the zip.  
3. Optional: `git tag v0.1.1 && git push origin v0.1.1` after committing the version bump.
