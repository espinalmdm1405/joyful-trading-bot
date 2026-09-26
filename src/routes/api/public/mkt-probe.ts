import { createFileRoute } from "@tanstack/react-router";

// Ruta temporal de diagnóstico para las fuentes de precios.
export const Route = createFileRoute("/api/public/mkt-probe")({
  server: {
    handlers: {
      GET: async () => {
        const out: Record<string, string> = {};
        const base = "https://query2.finance.yahoo.com/v8/finance/chart/";
        const tries: Array<[string, string, RequestInit]> = [
          ["15m-1mo", `${base}GC=F?interval=15m&range=1mo`, {}],
          ["15m-10d", `${base}GC=F?interval=15m&range=10d`, {}],
          ["15m-1mo-dji", `${base}%5EDJI?interval=15m&range=1mo`, {}],
          ["30m-1mo", `${base}GC=F?interval=30m&range=1mo`, {}],
          ["1h-3mo", `${base}GC=F?interval=1h&range=3mo`, {}],
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
