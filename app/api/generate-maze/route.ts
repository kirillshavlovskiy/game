/**
 * Next.js API route: generates a Creep Labyrinth maze via LLM in JSON format.
 * Supports Anthropic (ANTHROPIC_API_KEY) or OpenAI (OPENAI_API_KEY).
 * Returns { grid } for instant map building.
 */
export const maxDuration = 30;

const JSON_PROMPT = (n: number, w: number, h: number) =>
  `Generate a labyrinth as JSON only. Output ONLY valid JSON.

Requirements:
- "width": ${w}, "height": ${h}
- "grid": 2D array. "#" = wall, " " = path
- Start (0,0) and goal (${w - 1},${h - 1}) must be paths
- Exactly ${n} distinct paths from start to goal, same length
- Include walls - real labyrinth with corridors

Format: {"width":${w},"height":${h},"grid":[["#"," ",...],...]}

Generate now:`;

function extractJson(text: string): { width?: number; height?: number; grid?: string[][] } {
  text = text.trim();
  try {
    return JSON.parse(text);
  } catch {
    // ignore
  }
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) {
    try {
      return JSON.parse(m[1].trim());
    } catch {
      // ignore
    }
  }
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            // ignore
          }
        }
      }
    }
  }
  throw new Error("No valid JSON in response");
}

function normalizeGrid(
  data: { grid?: string[][] },
  width: number,
  height: number
): string[][] {
  const grid = data.grid || [];
  const out: string[][] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = [];
    for (let x = 0; x < width; x++) {
      const c = grid[y]?.[x];
      row.push(c === "#" || c === "wall" ? "#" : " ");
    }
    out.push(row);
  }
  out[0][0] = " ";
  out[height - 1][width - 1] = " ";
  return out;
}

async function callAnthropic(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text?.trim() || "";
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Output only valid JSON. No explanation." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() || "";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { numPaths = 3, width = 25, height = 25 } = body as {
      numPaths?: number;
      width?: number;
      height?: number;
    };
    const n = Math.min(Math.max(1, parseInt(String(numPaths), 10) || 3), 20);
    const w = Math.min(Math.max(5, parseInt(String(width), 10) || 25), 31);
    const h = Math.min(Math.max(5, parseInt(String(height), 10) || 25), 31);

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    const prompt = JSON_PROMPT(n, w, h);
    let text: string;

    if (anthropicKey) {
      text = await callAnthropic(anthropicKey, prompt);
    } else if (openaiKey) {
      text = await callOpenAI(openaiKey, prompt);
    } else {
      return Response.json(
        {
          error:
            "Set ANTHROPIC_API_KEY or OPENAI_API_KEY in Vercel project settings.",
        },
        { status: 500, headers: corsHeaders }
      );
    }

    const data = extractJson(text);
    const grid = normalizeGrid(data, w, h);
    return Response.json(
      { grid, width: w, height: h },
      { headers: corsHeaders }
    );
  } catch (e) {
    return Response.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 500, headers: corsHeaders }
    );
  }
}
