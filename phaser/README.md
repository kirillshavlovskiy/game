# Labyrinth - Phaser Battle

Player vs monster battle gameplay, ported to Phaser 3. Start of the labyrinth game migration.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Controls

- **WASD** or **Arrow keys** – move
- **R** – restart
- When in combat – click **ROLL DICE** or press to attack

## Gameplay

- Move around the arena. Monsters chase you when close.
- Land on a monster (or let one land on you) to start combat.
- Roll a d6: your roll + attack bonus must beat the monster's defense.
- Win: monster is defeated, you may gain HP/shield/attack bonus.
- Lose: take damage (or use a shield). Skeleton has 2 hits (first breaks shield).

## Monster Types

| Type | Defense | Damage | Special |
|------|---------|--------|---------|
| Zombie (Z) | 4 | 2 | — |
| Spider (S) | 3 | 1 | — |
| Ghost (G) | 3 | 1 | 50% evade |
| Skeleton (K) | 4 | 1 | Shield (2 hits) |
