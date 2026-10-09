// Estrategia AMBAR: reglas verificables, configurables y probables con datos históricos.
// Funciones puras (sin red) para poder usarlas en el bot y en las pruebas históricas.
import { atr, ema, rsi, type Candle } from "./indicators";

export const STRATEGY = {
  emaFast: 20,
  emaTrend: 100,
  htfFactor: 4, // 4 velas de 15 min = 1 hora
  htfEma: 20,
  rsiPeriod: 14,
  buyRsi: [40, 62] as [number, number],
  sellRsi: [38, 60] as [number, number],
  pullbackAtr: 0.6, // el precio tocó la EMA 20 (±0,6 ATR) en las últimas velas
  maxExtensionAtr: 1.2, // no entra si está a más de 1,2 ATR de la EMA 20
  minTrendGapAtr: 0.3, // EMA 20 vs EMA 100 separadas: evita mercado lateral
  slAtrMin: 0.8,
  slAtrMax: 1.8,
  rr: 1.5, // objetivo = 1,5 × riesgo
  maxSpreadOfStop: 0.15, // spread máximo: 15% de la distancia al stop
  swingLookback: 3,
  minScore: 75,
  weights: { trend: 20, htf: 15, structure: 15, pullback: 15, momentum: 15, room: 10, volatility: 5, costs: 5 },
};
export type StrategyConfig = typeof STRATEGY;

export type Check = { key: string; label: string; ok: boolean; required: boolean; weight: number; detail: string };
export type Decision = {
  action: "buy" | "sell" | "wait";
  score: number;
  checks: Check[];
  entry: number;
  stopLoss: number;
  takeProfit: number;
  risk: number;
  atr: number;
  rsi: number;
  summary: string;
};

function resample(c: Candle[], n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = c.length % n; i + n <= c.length; i += n) {
    const g = c.slice(i, i + n);
    out.push({ t: g[0]!.t, o: g[0]!.o, c: g[n - 1]!.c, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)) });
  }
  return out;
}

function swings(c: Candle[], k: number) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = k; i < c.length - k; i++) {
    const w = c.slice(i - k, i + k + 1);
    if (c[i]!.h === Math.max(...w.map((x) => x.h))) highs.push(c[i]!.h);
    if (c[i]!.l === Math.min(...w.map((x) => x.l))) lows.push(c[i]!.l);
  }
  return { highs, lows };
}

export function evaluate(
  candles: Candle[],
  opts: { spread?: number; newsBlocked?: string | null; cfg?: StrategyConfig } = {},
): Decision {
  const cfg = opts.cfg ?? STRATEGY;
  const wait = (summary: string): Decision => ({
    action: "wait", score: 0, checks: [], entry: candles.at(-1)?.c ?? 0, stopLoss: 0, takeProfit: 0, risk: 0, atr: 0, rsi: 50, summary,
  });
  if (candles.length < cfg.emaTrend + 20) return wait("Datos insuficientes: no se opera sin historial");

  const closes = candles.map((c) => c.c);
  const i = closes.length - 1;
  const price = closes[i]!;
  const e20s = ema(closes, cfg.emaFast);
  const e20 = e20s[i]!;
  const eT = ema(closes, cfg.emaTrend)[i]!;
  const a = atr(candles, 14);
  const r = rsi(closes, cfg.rsiPeriod);
  const rPrev = rsi(closes.slice(0, -1), cfg.rsiPeriod);
  if (!(a > 0)) return wait("Volatilidad desconocida: no se opera");

  const htf = resample(candles, cfg.htfFactor);
  const hc = htf.map((x) => x.c);
  const hE = ema(hc, cfg.htfEma);
  const htfDir = hc.at(-1)! > hE.at(-1)! && hE.at(-1)! > hE.at(-4)! ? "buy" : hc.at(-1)! < hE.at(-1)! && hE.at(-1)! < hE.at(-4)! ? "sell" : "flat";

  const gap = Math.abs(e20 - eT);
  const dir: "buy" | "sell" | "flat" = gap < cfg.minTrendGapAtr * a ? "flat" : e20 > eT && price > eT ? "buy" : e20 < eT && price < eT ? "sell" : "flat";
  if (dir === "flat") {
    return { ...wait(`ESPERAR: mercado lateral (EMA 20 y EMA ${cfg.emaTrend} sin separación clara)`), atr: a, rsi: r };
  }
  const isBuy = dir === "buy";
  const sgn = isBuy ? 1 : -1;

  const recent = candles.slice(-60, -cfg.swingLookback);
  const sw = swings(candles.slice(-60), cfg.swingLookback);
  const hh = sw.highs.slice(-2), ll = sw.lows.slice(-2);
  const structOk = hh.length === 2 && ll.length === 2 && (isBuy ? hh[1]! > hh[0]! && ll[1]! > ll[0]! : hh[1]! < hh[0]! && ll[1]! < ll[0]!);

  const last5 = candles.slice(-5);
  const touched = last5.some((c) => (isBuy ? c.l <= e20 + cfg.pullbackAtr * a : c.h >= e20 - cfg.pullbackAtr * a));
  const ext = (price - e20) * sgn;
  const pullOk = touched && ext <= cfg.maxExtensionAtr * a && ext >= -0.5 * a;

  const last = candles[i]!;
  const [lo, hi] = isBuy ? cfg.buyRsi : cfg.sellRsi;
  const momOk = r >= lo && r <= hi && (isBuy ? r > rPrev && last.c > last.o : r < rPrev && last.c < last.o);

  // Stop detrás del último mínimo/máximo, limitado por volatilidad.
  const swingStop = isBuy ? Math.min(...last5.map((c) => c.l)) - 0.2 * a : Math.max(...last5.map((c) => c.h)) + 0.2 * a;
  let risk = Math.abs(price - swingStop);
  risk = Math.min(Math.max(risk, cfg.slAtrMin * a), cfg.slAtrMax * a);
  const stopLoss = price - sgn * risk;
  const takeProfit = price + sgn * cfg.rr * risk;

  // Recorrido libre: la resistencia/soporte reciente no debe estar antes del objetivo.
  const barrier = isBuy ? Math.max(...recent.map((c) => c.h)) : Math.min(...recent.map((c) => c.l));
  const roomDist = (barrier - price) * sgn;
  const roomOk = roomDist <= 0 || roomDist >= cfg.rr * risk * 0.9;

  const volPct = (a / price) * 100;
  const volOk = volPct > 0.03 && volPct < 1.5;
  const spread = opts.spread ?? 0;
  const costOk = spread <= cfg.maxSpreadOfStop * risk;
  const w = cfg.weights;

  const checks: Check[] = [
    { key: "trend", label: "Tendencia principal", ok: true, required: true, weight: w.trend, detail: `EMA 20 ${isBuy ? "sobre" : "bajo"} EMA ${cfg.emaTrend}` },
    { key: "htf", label: "Temporalidad de 1 hora", ok: htfDir === dir, required: true, weight: w.htf, detail: htfDir === "flat" ? "1 hora sin dirección" : `1 hora ${htfDir === "buy" ? "alcista" : "bajista"}` },
    { key: "structure", label: "Máximos y mínimos", ok: structOk, required: false, weight: w.structure, detail: structOk ? (isBuy ? "Máximos y mínimos crecientes" : "Máximos y mínimos decrecientes") : "Estructura no confirma" },
    { key: "pullback", label: "Retroceso a la EMA 20", ok: pullOk, required: true, weight: w.pullback, detail: pullOk ? "Entrada tras retroceso, sin perseguir" : ext > cfg.maxExtensionAtr * a ? "Precio demasiado estirado" : "Sin retroceso a la EMA 20" },
    { key: "momentum", label: "RSI e impulso", ok: momOk, required: true, weight: w.momentum, detail: `RSI ${r.toFixed(0)} (${r > rPrev ? "subiendo" : "bajando"}), vela ${last.c > last.o ? "alcista" : "bajista"}` },
    { key: "room", label: "Recorrido hasta el objetivo", ok: roomOk, required: true, weight: w.room, detail: roomOk ? "Sin barrera antes del objetivo" : `Barrera en ${barrier.toFixed(2)} antes del objetivo` },
    { key: "volatility", label: "Volatilidad (ATR)", ok: volOk, required: false, weight: w.volatility, detail: `ATR ${a.toFixed(2)} (${volPct.toFixed(2)}% del precio)` },
    { key: "costs", label: "Spread y costes", ok: costOk, required: true, weight: w.costs, detail: opts.spread == null ? "Spread no medido (se revisa al ejecutar)" : `Spread ${spread.toFixed(2)} vs stop ${risk.toFixed(2)}` },
    { key: "news", label: "Noticias de alto impacto", ok: !opts.newsBlocked, required: true, weight: 0, detail: opts.newsBlocked ? `Noticia: ${opts.newsBlocked}` : "Sin noticias fuertes cerca" },
  ];

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const score = Math.round((checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0) / total) * 100);
  const failed = checks.filter((c) => !c.ok);
  const blocker = failed.find((c) => c.required);
  const accept = !blocker && score >= cfg.minScore;
  const summary = accept
    ? `${isBuy ? "COMPRA" : "VENTA"} aceptada (puntuación ${score}/100): ${checks.filter((c) => c.ok).map((c) => c.label).join(", ")}`
    : `ESPERAR (puntuación ${score}/100): ${(blocker ?? failed[0])?.label ?? "puntuación baja"} — ${(blocker ?? failed[0])?.detail ?? ""}`;

  return { action: accept ? dir : "wait", score, checks, entry: price, stopLoss, takeProfit, risk, atr: a, rsi: r, summary };
}
