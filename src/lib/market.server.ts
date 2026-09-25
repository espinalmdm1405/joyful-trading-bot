import type { Candle } from "./indicators";

export type MarketDef = {
  symbol: string;
  name: string;
  yahoo: string;
  decimals: number;
};

export const MARKETS: MarketDef[] = [
  { symbol: "XAUUSD", name: "Oro / Dólar", yahoo: "GC=F", decimals: 2 },
  { symbol: "US30", name: "Dow Jones 30", yahoo: "^DJI", decimals: 1 },
  { symbol: "NAS100", name: "Nasdaq 100", yahoo: "^NDX", decimals: 1 },
  { symbol: "SPX500", name: "S&P 500", yahoo: "^GSPC", decimals: 1 },
  { symbol: "GER40", name: "DAX 40", yahoo: "^GDAXI", decimals: 1 },
];

export function marketBySymbol(symbol: string) {
  return MARKETS.find((m) => m.symbol === symbol);
}

const HOSTS = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"];

export async function fetchCandles(yahoo: string): Promise<Candle[]> {
  const path = `/v8/finance/chart/${encodeURIComponent(yahoo)}?interval=15m&range=1mo`;

  let res: Response | null = null;
  for (const host of HOSTS) {
    try {
      const attempt = await fetch(`${host}${path}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (attempt.ok) {
        res = attempt;
        break;
      }
    } catch {
      // try next host
    }
  }
  if (!res) throw new Error("Datos de mercado no disponibles ahora");

  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: (number | null)[];
            high?: (number | null)[];
            low?: (number | null)[];
            close?: (number | null)[];
          }>;
        };
      }>;
      error?: { description?: string } | null;
    };
  };

  const result = json.chart?.result?.[0];
  const q = result?.indicators?.quote?.[0];
  const ts = result?.timestamp;
  if (!result || !q || !ts) throw new Error("Datos de mercado vacíos");

  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ t: (ts[i] ?? 0) * 1000, o, h, l, c });
  }
  return candles;
}
