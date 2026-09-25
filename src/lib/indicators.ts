export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
};

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  values.forEach((v, i) => {
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return 100;
  const rs = gain / period / (loss / period);
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
}

export function macdHistogram(values: number[]): number {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const macdLine = values.map((_, i) => fast[i] - slow[i]);
  const signal = ema(macdLine, 9);
  const last = values.length - 1;
  return macdLine[last] - signal[last];
}

export type Analysis = {
  price: number;
  changePct: number;
  score: number;
  direction: "buy" | "sell" | "flat";
  confidence: number;
  atr: number;
  rsi: number;
  ema9: number;
  ema21: number;
  ema50: number;
  macdHist: number;
  notes: string[];
};

export function analyze(candles: Candle[]): Analysis | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1];
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const i = closes.length - 1;
  const r = rsi(closes, 14);
  const a = atr(candles, 14);
  const hist = macdHistogram(closes);
  const dayAgo = closes[Math.max(0, closes.length - 26)];

  let score = 0;
  const notes: string[] = [];

  if (e9[i] > e21[i] && e21[i] > e50[i]) {
    score += 2;
    notes.push("Medias alineadas al alza (9 > 21 > 50)");
  } else if (e9[i] < e21[i] && e21[i] < e50[i]) {
    score -= 2;
    notes.push("Medias alineadas a la baja (9 < 21 < 50)");
  } else {
    notes.push("Medias mezcladas: tendencia poco definida");
  }

  if (hist > 0) {
    score += 1;
    notes.push("MACD con impulso comprador");
  } else if (hist < 0) {
    score -= 1;
    notes.push("MACD con impulso vendedor");
  }

  if (r > 75) {
    score -= 1;
    notes.push(`RSI ${r.toFixed(0)}: sobrecompra, riesgo de retroceso`);
  } else if (r < 25) {
    score += 1;
    notes.push(`RSI ${r.toFixed(0)}: sobreventa, posible rebote`);
  } else if (r > 55) {
    score += 1;
    notes.push(`RSI ${r.toFixed(0)}: fuerza compradora`);
  } else if (r < 45) {
    score -= 1;
    notes.push(`RSI ${r.toFixed(0)}: fuerza vendedora`);
  }

  if (last > e50[i]) {
    score += 1;
    notes.push("Precio por encima de la media de 50");
  } else {
    score -= 1;
    notes.push("Precio por debajo de la media de 50");
  }

  const direction = score >= 3 ? "buy" : score <= -3 ? "sell" : "flat";

  return {
    price: last,
    changePct: dayAgo ? ((last - dayAgo) / dayAgo) * 100 : 0,
    score,
    direction,
    confidence: Math.min(100, Math.round((Math.abs(score) / 5) * 100)),
    atr: a,
    rsi: r,
    ema9: e9[i],
    ema21: e21[i],
    ema50: e50[i],
    macdHist: hist,
    notes,
  };
}
