import { createFileRoute } from "@tanstack/react-router";

// Ruta temporal de diagnóstico para la fuente de precios.
export const Route = createFileRoute("/api/public/mkt-probe")({
  server: {
    handlers: {
      GET: async () => {
        const r = await fetch(
          "https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=15m&range=1mo",
        );
        return new Response(`${r.status} ${(await r.text()).slice(0, 80)}`);
      },
    },
  },
});
