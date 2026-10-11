// Estrategia AMBAR M1 (scalping 1 minuto) — EN PRUEBA, no conectada a la cuenta real.
// Función pura: recibe velas de 1 minuto y devuelve BUY score, SELL score y la decisión.
import { atr, ema, rsi, type Candle } from "./indicators";

export const STRATEGY_M1 = {
  minScore: 80,
  rr: 1.5,
  slAtrMin: 1.0,
  slAtrMax: 2.5,
  maxSpreadOfStop: 0.15,
  maxExtensionAtr: 1.5,
  weights: { trend: 20, structure: 15, mtf: 15, candle: 10, momentum: 10, sr: 10, ema: 5, rsi: 5, volatility: 5, costs: 5 },
};
export type M1Config = typeof STRATEGY_M1;

type Dir = "buy" | "sell" | "flat";
export type M1Decision = {
  action: "buy" | "sell" | "wait";
  buyScore: number;
  sellScore: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  risk: number;
  atr: number;
  rsi: number;
  tf: { m1: Dir; m5: Dir; m15: Dir; h1: Dir };
  pattern: string;
  reason: string;
};

function resample(c: Candle[], n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = c.length % n; i + n <= c.length; i += n) {
    const g = c.slice(i, i + n);
    out.push({ t: g[0]!.t, o: g[0]!.o, c: g[n - 1]!.c, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)) });
  }
  return out;
}

// Tendencia con EMA 20/50 (y 100/200 si hay historial suficiente).
function trendOf(c: Candle[]): Dir {
  const cl = c.map((x) => x.c);
  if (cl.length < 60) return "flat";
  const p = cl.at(-1)!;
  const e20 = ema(cl, 20), e50 = ema(cl, 50);
  const a = e20.at(-1)!, b = e50.at(-1)!, slope = a - e20.at(-4)!;
  let up = p > a && a > b && slope > 0;
  let dn = p < a && a < b && slope < 0;
  if (cl.length >= 220) {
    const e200 = ema(cl, 200).at(-1)!;
    up = up && p > e200;
    dn = dn && p < e200;
  }
  return up ? "buy" : dn ? "sell" : "flat";
}

function pattern(prev: Candle, k: Candle, a: number): { name: string; bull: boolean; bear: boolean; huge: boolean } {
  const body = Math.abs(k.c - k.o), range = k.h - k.l || 1e-9;
  const up = k.h - Math.max(k.o, k.c), lo = Math.min(k.o, k.c) - k.l;
  const huge = range > 2.2 * a;
  if (body / range < 0.1) return { name: "doji", bull: false, bear: false, huge };
  if (lo > 2 * body && lo > up) return { name: "martillo/rechazo alcista", bull: true, bear: false, huge };
  if (up > 2 * body && up > lo) return { name: "estrella fugaz/rechazo bajista", bull: false, bear: true, huge };
  if (k.c > k.o && prev.c < prev.o && k.c >= prev.o && k.o <= prev.c) return { name: "envolvente alcista", bull: true, bear: false, huge };
  if (k.c < k.o && prev.c > prev.o && k.c <= prev.o && k.o >= prev.c) return { name: "envolvente bajista", bull: false, bear: true, huge };
  if (k.h < prev.h && k.l > prev.l) return { name: "inside bar", bull: false, bear: false, huge };
  return { name: k.c > k.o ? "vela alcista" : "vela bajista", bull: k.c > k.o && body / range > 0.5, bear: k.c < k.o && body / range > 0.5, huge };
}

export function evaluateM1(c: Candle[], opts: { spread?: number; cfg?: M1Config } = {}): M1Decision {
  const cfg = opts.cfg ?? STRATEGY_M1;
  const price = c.at(-1)?.c ?? 0;
  const base = { buyScore: 0, sellScore: 0, entry: price, stopLoss: 0, takeProfit: 0, risk: 0, atr: 0, rsi: 50, tf: { m1: "flat", m5: "flat", m15: "flat", h1: "flat" } as M1Decision["tf"], pattern: "-" };
  if (c.length < 1500) return { ...base, action: "wait", reason: "Datos insuficientes" };

  const cl = c.map((x) => x.c);
  const a = atr(c, 14), r = rsi(cl, 14), rPrev = rsi(cl.slice(0, -1), 14);
  if (!(a > 0)) return { ...base, action: "wait", reason: "Volatilidad desconocida" };
  const m1 = trendOf(c.slice(-300)), m5 = trendOf(resample(c, 5)), m15 = trendOf(resample(c, 15)), h1 = trendOf(resample(c, 60));
  const tf = { m1, m5, m15, h1 };
  const e20 = ema(cl, 20).at(-1)!;
  const k = c.at(-1)!, prev = c.at(-2)!;
  const pat = pattern(prev, k, a);
  const last10 = c.slice(-10), recent = c.slice(-90, -5);
  const resist = Math.max(...recent.map((x) => x.h)), support = Math.min(...recent.map((x) => x.l));
  const atrSlow = atr(c.slice(-300), 100);
  const volOk = atrSlow > 0 && a > 0.6 * atrSlow && a < 2.5 * atrSlow;
  const spread = opts.spread ?? 0;
  const w = cfg.weights;

  const side = (isBuy: boolean) => {
    const d: Dir = isBuy ? "buy" : "sell", s = isBuy ? 1 : -1;
    const agree = [m5, m15, h1].filter((x) => x === d).length;
    const against = [m15, h1].some((x) => x === (isBuy ? "sell" : "buy"));
    const lows = isBuy ? [c.slice(-30, -15), c.slice(-15)].map((g) => Math.min(...g.map((x) => x.l))) : [c.slice(-30, -15), c.slice(-15)].map((g) => Math.max(...g.map((x) => x.h)));
    const struct = isBuy ? lows[1]! > lows[0]! : lows[1]! < lows[0]!;
    const touched = last10.some((x) => (isBuy ? x.l <= e20 + 0.3 * a : x.h >= e20 - 0.3 * a));
    const ext = (price - e20) * s;
    const candleOk = isBuy ? pat.bull : pat.bear;
    const momOk = isBuy ? r > rPrev && r >= 45 && r <= 65 : r < rPrev && r <= 55 && r >= 35;
    const swingStop = isBuy ? Math.min(...last10.map((x) => x.l)) - 0.3 * a : Math.max(...last10.map((x) => x.h)) + 0.3 * a;
    const risk = Math.min(Math.max(Math.abs(price - swingStop), cfg.slAtrMin * a), cfg.slAtrMax * a);
    const room = isBuy ? resist - price : price - support;
    const srOk = room <= 0 || room >= cfg.rr * risk;
    const costOk = spread <= cfg.maxSpreadOfStop * risk;
    let score = 0;
    if (m1 === d) score += w.trend;
    if (struct) score += w.structure;
    score += (w.mtf * agree) / 3;
    if (candleOk) score += w.candle;
    if (momOk) score += w.momentum;
    if (srOk) score += w.sr;
    if (touched && ext <= cfg.maxExtensionAtr * a) score += w.ema;
    if (r > 30 && r < 70) score += w.rsi;
    if (volOk) score += w.volatility;
    if (costOk) score += w.costs;
    const blocks: string[] = [];
    if (against) blocks.push("M15/H1 en contra");
    if (!touched) blocks.push("sin retroceso a la EMA 20");
    if (ext > cfg.maxExtensionAtr * a || pat.huge) blocks.push("precio estirado");
    if (!srOk) blocks.push("poco espacio hasta soporte/resistencia");
    if (!costOk) blocks.push("spread alto");
    if (!volOk) blocks.push("volatilidad anormal");
    return { score: Math.round(score), risk, blocks };
  };
  const B = side(true), S = side(false);
  const best = B.score >= S.score ? { d: "buy" as const, ...B } : { d: "sell" as const, ...S };
  const out = { ...base, buyScore: B.score, sellScore: S.score, atr: a, rsi: r, tf, pattern: pat.name };
  if (best.score < cfg.minScore) return { ...out, action: "wait", reason: `Score insuficiente (${best.score})` };
  if (best.blocks.length) return { ...out, action: "wait", reason: best.blocks.join(", ") };
  const s = best.d === "buy" ? 1 : -1;
  return { ...out, action: best.d, risk: best.risk, stopLoss: price - s * best.risk, takeProfit: price + s * cfg.rr * best.risk, reason: `${best.d === "buy" ? "COMPRA" : "VENTA"} ${best.score}/100 · ${pat.name}` };
}
