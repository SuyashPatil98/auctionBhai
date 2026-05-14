/**
 * One-shot Gemini smoke test. Sends a single player prompt and prints the
 * raw response so we can see why JSON parsing might be failing.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { GoogleGenerativeAI } from "@google/generative-ai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: `Output JSON only — no markdown, no commentary.
Shape: { "score": <number 0-100>, "confidence": "high"|"medium"|"low", "reasoning": "<one short sentence>" }`,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 200,
    },
  });

  const prompt = `Player: Julián Álvarez
Country: Argentina
Age: 26 (DOB 2000-01-31)
Position: FWD
Club: Atlético Madrid

Rate this player 0-100 relative to other forwards heading into the 2026 World Cup.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  console.log("---RAW---");
  console.log(text);
  console.log("---END---");
  console.log("length:", text.length);
  try {
    const parsed = JSON.parse(text);
    console.log("Parsed:", parsed);
  } catch (e) {
    console.log("Parse error:", e instanceof Error ? e.message : e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
