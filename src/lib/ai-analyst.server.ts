import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

import { createLovableAiGatewayRunIdFetch } from "./run-id";
import type { Analysis } from "./indicators";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";

/**
 * Short Spanish rationale for a trade the rules engine already approved.
 * Returns null when the gateway is unavailable so trading never blocks on AI.
 */
export async function aiRationale(input: {
  symbol: string;
  name: string;
  analysis: Analysis;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskPct: number;
}): Promise<string | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const a = input.analysis;
  const prompt = [
    `Instrumento: ${input.name} (${input.symbol})`,
    `Dirección propuesta: ${a.direction === "buy" ? "COMPRA" : "VENTA"}`,
    `Precio: ${input.entry.toFixed(2)} | Stop: ${input.stopLoss.toFixed(2)} | Objetivo: ${input.takeProfit.toFixed(2)}`,
    `Riesgo por operación: ${input.riskPct}% del capital`,
    `RSI ${a.rsi.toFixed(1)} | MACD ${a.macdHist.toFixed(3)} | ATR ${a.atr.toFixed(2)}`,
    `EMA9 ${a.ema9.toFixed(2)} | EMA21 ${a.ema21.toFixed(2)} | EMA50 ${a.ema50.toFixed(2)}`,
    `Señales detectadas: ${a.notes.join("; ")}`,
  ].join("\n");

  try {
    const result = streamText({
      model: provider.responses(MODEL),
      system:
        "Eres un analista de mercados. Explica en español claro, máximo 2 frases y 220 caracteres, por qué esta operación tiene sentido según los datos. Sin promesas de ganancia, sin listas, sin emojis.",
      messages: [{ role: "user", content: prompt }],
      providerOptions: {
        openai: {
          store: false,
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    const text = (await result.text).trim();
    return text ? text.slice(0, 400) : null;
  } catch (error) {
    console.error("aiRationale failed", error);
    return null;
  }
}
