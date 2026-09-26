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
const CACHE_MS = 90_000;
const cache = new Map<string, { at: number; candles: Candle[] }>();

// The quote provider throttles bursts, so requests are queued one at a time.
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(yahoo: string): Promise<Candle[]> {
  const path = `/v8/finance/chart/${encodeURIComponent(yahoo)}?interval=15m&range=1mo`;

  let res: Response | null = null;
  for (let attemptIndex = 0; attemptIndex < 4 && !res; attemptIndex++) {
    const host = HOSTS[attemptIndex % HOSTS.length]!;
    try {
      const attempt = await fetch(`${host}${path}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (attempt.ok) res = attempt;
      else await sleep(700 * (attemptIndex + 1));
    } catch {
      await sleep(400);
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

export function fetchCandles(yahoo: string): Promise<Candle[]> {
  const hit = cache.get(yahoo);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.candles);

  return serialize(async () => {
    const fresh = cache.get(yahoo);
    if (fresh && Date.now() - fresh.at < CACHE_MS) return fresh.candles;
    try {
      const candles = await request(yahoo);
      cache.set(yahoo, { at: Date.now(), candles });
      return candles;
    } catch (error) {
      const stale = cache.get(yahoo);
      if (stale) return stale.candles;
      throw error;
    }
  });
}
