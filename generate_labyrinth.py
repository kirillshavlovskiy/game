"""
Generate a labyrinth in JSON format via Claude (Anthropic).
Output can be used to build the map with walls instantly.
"""
import anthropic
import json
import os
import sys


def load_env(path="local.env"):
    """Load KEY=value pairs from local.env into os.environ."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip().strip('"').strip("'")


def extract_json(text: str) -> dict:
    """Extract JSON from LLM response (handles markdown code blocks)."""
    text = text.strip()
    # Try raw parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try to extract from ```json ... ```
    if "```" in text:
        start = text.find("```json")
        if start >= 0:
            start += 7
        else:
            start = text.find("```") + 3
        end = text.find("```", start)
        if end > start:
            return json.loads(text[start:end].strip())
    # Try to find {...}
    i = text.find("{")
    if i >= 0:
        depth = 0
        for j in range(i, len(text)):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[i : j + 1])
    raise ValueError("No valid JSON found in response")


def normalize_grid(data: dict, width: int = 11, height: int = 11) -> list:
    """Ensure grid is width x height, # for walls, space for paths."""
    grid = data.get("grid", [])
    if not isinstance(grid, list):
        raise ValueError("grid must be a 2D array")
    out = []
    for y in range(height):
        row = []
        for x in range(width):
            if y < len(grid) and x < len(grid[y]):
                c = grid[y][x]
                row.append("#" if (c == "#" or c == "wall") else " ")
            else:
                row.append("#")
        out.append(row)
    out[0][0] = " "
    out[height - 1][width - 1] = " "
    return out


load_env()
api_key = os.environ.get("ANTHROPIC_API_KEY")
if not api_key:
    raise SystemExit("Set ANTHROPIC_API_KEY in local.env")

num_paths = int(sys.argv[1]) if len(sys.argv) > 1 else 3
width = int(os.environ.get("LABYRINTH_WIDTH", "11"))
height = int(os.environ.get("LABYRINTH_HEIGHT", "11"))

PROMPT = f"""Generate a labyrinth (maze) as a JSON object. Output ONLY valid JSON, no other text.

Requirements:
- "width": {width}, "height": {height}
- "grid": 2D array of strings. Use "#" for walls, " " (space) for walkable paths
- Start at top-left (0,0), goal at bottom-right ({width-1},{height-1})
- At least one valid path from start to goal
- Exactly {num_paths} distinct paths from start to goal, each of the SAME length
- Paths can intersect. Include walls so it looks like a real labyrinth.

Example format:
{{"width":11,"height":11,"grid":[["#"," ","#",...],["#"," "," ","#",...],...]}}

Generate the labyrinth now:"""

client = anthropic.Anthropic(api_key=api_key)

response = client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=2048,
    messages=[{"role": "user", "content": PROMPT}],
)

text = response.content[0].text
data = extract_json(text)
grid = normalize_grid(data, width, height)

result = {"width": width, "height": height, "grid": grid}
print(json.dumps(result, separators=(",", ":")))
