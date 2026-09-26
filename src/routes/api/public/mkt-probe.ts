import { createFileRoute } from "@tanstack/react-router";

// Ruta temporal de diagnóstico para las fuentes de precios.
export const Route = createFileRoute("/api/public/mkt-probe")({
  server: {
    handlers: {
      GET: async () => {
        const out: Record<string, string> = {};
        const tries: Array<[string, string, RequestInit]> = [
          [
            "yahoo-ua",
            "https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=15m&range=5d",
            { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } },
          ],
          [
            "yahoo-bare",
            "https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=15m&range=5d",
            {},
          ],
          [
            "stooq",
            "https://stooq.com/q/d/l/?s=xauusd&i=d",
            {},
          ],
          [
            "binance",
            "https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=15m&limit=5",
            {},
          ],
          [
            "frankfurter",
            "https://api.frankfurter.app/latest?from=USD&to=EUR",
            {},
          ],
        ];
        for (const [name, url, init] of tries) {
          try {
            const r = await fetch(url, init);
            const body = (await r.text()).slice(0, 120);
            out[name] = `${r.status} ${body}`;
          } catch (e) {
            out[name] = `ERR ${String(e)}`;
          }
        }
        return new Response(JSON.stringify(out, null, 2), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
