# Creep Labyrinth

A DOS-style maze game with random labyrinths, AI-generated mazes, and 3D dice.

Built with **Next.js 14** (App Router) and **@3d-dice/dice-box-threejs**.

## Features

- **Proper walls** – Mazes with corridors and walls (7×7 to 21×21)
- **Multiple paths** – Several routes from start (S) to goal (X)
- **3D dice** – Roll physical-style dice with Three.js
- **AI generation** – Use OpenAI or Anthropic to create mazes with N paths of equal length
- **Number of players** – Set how many paths (players) the maze should support

## Controls

- **WASD** or **Arrow keys** – Move
- **R** – New random maze
- **Roll dice** – Click the button or the 3D dice area to roll
- **Generate with AI** – Create maze via LLM (requires API key)

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Vercel Deployment

1. Push to GitHub and connect the repo to Vercel.
2. Add environment variables in Vercel project settings:
   - `OPENAI_API_KEY` – Your OpenAI API key (for AI maze generation), or
   - `ANTHROPIC_API_KEY` – Your Anthropic API key
3. Deploy. The game runs at your Vercel URL.

Without an API key, the "Generate with AI" button will show an error; the random maze still works.
