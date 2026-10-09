// Prueba histórica reproducible: bun scripts/backtest.ts
import { evaluate } from "../src/lib/strategy";
import type { Candle } from "../src/lib/indicators";

const MK = [
  { s: "XAUUSD", y: "GC=F", spread: 0.35 },
  { s: "US30", y: "^DJI", spread: 2.5 },
  { s: "NAS100", y: "^NDX", spread: 1.5 },
  { s: "SPX500", y: "^GSPC", spread: 0.6 },
  { s: "GER40", y: "^GDAXI", spread: 1.5 },
];

async function load(y: string): Promise<Candle[]> {
  const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=15m&range=60d`);
  const j: any = await r.json();
  const res = j.chart.result[0];
  const q = res.indicators.quote[0];
  return res.timestamp.map((t: number, i: number) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter((c: Candle) => c.o && c.h && c.l && c.c);
}

type T = { r: number; side: string };
function run(c: Candle[], spread: number, from: number, to: number): T[] {
  const out: T[] = [];
  let i = Math.max(from, 140);
  while (i < to - 1) {
    const d = evaluate(c.slice(0, i + 1), { spread });
    if (d.action === "wait") { i++; continue; }
    const buy = d.action === "buy";
    const entry = c[i + 1]!.o + (buy ? spread : -spread) / 2;
    const sl = entry - (buy ? 1 : -1) * d.risk, tp = entry + (buy ? 1 : -1) * 1.5 * d.risk;
    let j = i + 1, r: number | null = null;
    for (; j < c.length; j++) {
      const k = c[j]!;
      if (buy ? k.l <= sl : k.h >= sl) { r = -1 - spread / 2 / d.risk; break; }
      if (buy ? k.h >= tp : k.l <= tp) { r = 1.5 - spread / 2 / d.risk; break; }
    }
    if (r == null) break;
    out.push({ r, side: d.action });
    i = j + 1;
  }
  return out;
}

function stats(name: string, t: T[]) {
  const w = t.filter((x) => x.r > 0), l = t.filter((x) => x.r <= 0);
  let eq = 0, peak = 0, dd = 0;
  for (const x of t) { eq += x.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const gp = w.reduce((s, x) => s + x.r, 0), gl = -l.reduce((s, x) => s + x.r, 0);
  console.log(`${name.padEnd(22)} ops ${String(t.length).padStart(3)} | aciertos ${t.length ? Math.round((w.length / t.length) * 100) : 0}% | neto ${eq.toFixed(1)}R | factor ${gl ? (gp / gl).toFixed(2) : "-"} | caída máx ${dd.toFixed(1)}R | compras ${t.filter((x) => x.side === "buy").length} ventas ${t.filter((x) => x.side === "sell").length}`);
}

const allDev: T[] = [], allVal: T[] = [];
for (const m of MK) {
  const c = await load(m.y);
  const cut = Math.floor(c.length * 0.7);
  const dev = run(c, m.spread, 0, cut), val = run(c, m.spread, cut - 140, c.length);
  allDev.push(...dev); allVal.push(...val);
  stats(`${m.s} desarrollo`, dev); stats(`${m.s} validación`, val);
  await new Promise((r) => setTimeout(r, 400));
}
console.log("---"); stats("TOTAL desarrollo", allDev); stats("TOTAL validación", allVal);
