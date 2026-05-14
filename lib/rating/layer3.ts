/**
 * Layer 3 of the rating engine: Gemini-augmented player research.
 *
 * Targets the gap that Layer 2 (Transfermarkt market value) can't fill —
 * players with no TM match (7% of WC squad) or a weak match (10%). For
 * each candidate, sends a structured prompt to Gemini Flash and parses
 * a JSON response containing rating + confidence + reasoning.
 *
 * Rate-limited to stay well under the Gemini free tier (15 RPM for
 * gemini-2.0-flash). Cost for ~200 candidates ≈ $0.20.
 */

import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { ageFromDob } from "./baseline";
import type { PlayerMatchRow } from "./match";

const MODEL_NAME = "gemini-2.5-flash-lite";

// gemini-2.5-flash-lite free tier: 15 RPM. 4.5s/request leaves headroom.
const REQUEST_INTERVAL_MS = 4500;

// 503 transient handling.
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [2000, 5000, 12000];

const SYSTEM_PROMPT = `You are a football scouting analyst rating players for the 2026 FIFA World Cup.

For each player you receive, output a JSON object — and only JSON — with this shape:
{
  "score": <number 0-100>,
  "confidence": "high" | "medium" | "low",
  "reasoning": "<one short sentence>"
}

Rules:
- Rate the player on a 0-100 scale relative to other players in their listed position pool heading into the 2026 World Cup.
- Consider recent club form (2024-2026 seasons), international form, tournament pedigree (prior WC / Euro / Copa America starts), and likely role for their national team.
- "high" confidence: you know the player well and have strong evidence for the rating.
- "medium": you recognize the player but have limited recent-form information.
- "low": you don't recognize the player, or only by name. Output rating around 45-55 in this case.
- 90+ should be reserved for genuinely elite players in their position pool. 80-89 for strong starters. 70-79 for rotation-tier starters. 60-69 for backups. Below 60 for fringe / unknown.
- Do not include any text outside the JSON object.`;

type Layer3Output = {
  score: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
};

export type Layer3Result = {
  realPlayerId: string;
  layer3: Layer3Output;
};

function userPromptFor(p: PlayerMatchRow): string {
  const age = ageFromDob(p.dob);
  return [
    `Player: ${p.realPlayerName}`,
    `Country: ${p.countryName ?? "unknown"}`,
    `Age: ${age ?? "unknown"}${p.dob ? ` (DOB ${p.dob})` : ""}`,
    `Position: ${p.position}`,
    p.club ? `Club: ${p.club}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseJsonResponse(text: string): Layer3Output | null {
  // Strip code fences if the model wrapped its response.
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<
      Layer3Output & { rating?: number }
    >;
    // Tolerate both {score} and {rating} keys in case the model drifts.
    const raw =
      typeof parsed.score === "number"
        ? parsed.score
        : typeof parsed.rating === "number"
        ? parsed.rating
        : null;
    if (
      raw !== null &&
      (parsed.confidence === "high" ||
        parsed.confidence === "medium" ||
        parsed.confidence === "low") &&
      typeof parsed.reasoning === "string"
    ) {
      const score = Math.max(0, Math.min(100, raw));
      return {
        score,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning.slice(0, 200),
      };
    }
  } catch {
    // fallthrough
  }
  return null;
}

async function callGemini(
  model: GenerativeModel,
  prompt: string
): Promise<Layer3Output | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = parseJsonResponse(text);
      if (parsed) return parsed;
      // Empty / malformed — log a short preview for debugging.
      console.warn(
        `\n  Gemini returned unparseable response: ${text.slice(0, 80)}`
      );
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTransient =
        message.includes("503") ||
        message.includes("Service Unavailable") ||
        message.includes("UNAVAILABLE") ||
        message.includes("429");
      if (!isTransient || attempt === MAX_RETRIES - 1) {
        console.warn(`\n  Gemini call failed (final): ${message.slice(0, 120)}`);
        return null;
      }
      await sleep(RETRY_BACKOFF_MS[attempt] ?? 10_000);
    }
  }
  return null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Researches each candidate player with Gemini and returns a Layer 3 score.
 * Skips candidates that fail to parse or error out — caller falls back to
 * Layer 1/2 for those.
 */
export async function researchPlayersWithGemini(
  candidates: PlayerMatchRow[]
): Promise<Layer3Result[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 200,
    },
  });

  const results: Layer3Result[] = [];
  let i = 0;
  for (const c of candidates) {
    i++;
    const prompt = userPromptFor(c);
    const output = await callGemini(model, prompt);
    if (output) {
      results.push({ realPlayerId: c.realPlayerId, layer3: output });
    }
    process.stdout.write(
      `\r  layer 3: ${i}/${candidates.length} (${results.length} parsed)`
    );

    // Stay under 15 RPM. Skip the wait on the last iteration.
    if (i < candidates.length) {
      await sleep(REQUEST_INTERVAL_MS);
    }
  }
  process.stdout.write("\n");

  return results;
}
