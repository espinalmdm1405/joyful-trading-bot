// Muestra un ejemplo real de COMPRA, VENTA y ESPERAR: bun run ./scripts/scenarios.ts
import { evaluate } from "../src/lib/strategy";
const r = await fetch("https://query2.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=15m&range=60d");
const res: any = ((await r.json()) as any).chart.result[0];
const q = res.indicators.quote[0];
const c = res.timestamp.map((t: number, i: number) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter((x: any) => x.o && x.c);
const found: Record<string, boolean> = {};
for (let i = 200; i < c.length && Object.keys(found).length < 3; i++) {
  const d = evaluate(c.slice(0, i + 1), { spread: 0.35 });
  if (found[d.action] || (d.action === "wait" && !d.checks.length)) continue;
  found[d.action] = true;
  const balance = 175, riskPct = 0.5, money = (balance * riskPct) / 100;
  console.log(`\n=== ${d.action.toUpperCase()} · oro · ${new Date(c[i].t * 1000).toISOString()} ===`);
  console.log(d.summary);
  for (const k of d.checks) console.log(` ${k.ok ? "✔" : "✘"} ${k.label}${k.required ? " (obligatoria)" : ""}: ${k.detail}`);
  if (d.action !== "wait")
    console.log(` Entrada ${d.entry.toFixed(2)} · Stop ${d.stopLoss.toFixed(2)} · Objetivo ${d.takeProfit.toFixed(2)} · Riesgo ${money.toFixed(2)} USD / ${d.risk.toFixed(2)} = ${(money / d.risk).toFixed(3)} onzas`);
}
