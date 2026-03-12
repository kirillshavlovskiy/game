# Labyrinth Game

A DOS-style maze game with random labyrinths and AI-generated mazes.

## Features

- **Proper walls** – Mazes with corridors and walls (11×11 grid)
- **Multiple paths** – Several routes from start (S) to goal (X)
- **AI generation** – Use OpenAI to create mazes with N paths of equal length
- **Number of players** – Set how many paths (players) the maze should support

## Controls

- **WASD** or **Arrow keys** – Move
- **R** – New random maze
- **Generate with AI** – Create maze via LLM (requires API key)

## Vercel Deployment

1. Push to GitHub and connect the repo to Vercel.
2. Add environment variable in Vercel project settings:
   - `OPENAI_API_KEY` – Your OpenAI API key (for AI maze generation)
3. Deploy. The game runs at your Vercel URL.

Without `OPENAI_API_KEY`, the "Generate with AI" button will show an error; the random maze still works.
