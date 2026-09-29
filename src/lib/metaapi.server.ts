// Puente con MetaTrader 5 a través de MetaApi (REST).
const PROV = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts";

// Riesgo máximo por operación en la cuenta real, elegido por el usuario.
export const LIVE_RISK_CAP = 0.5;
// Lote fijo por ráfaga y ráfagas por señal, elegidos por el usuario.
const FIXED_LOT = 0.03;
const BURSTS = 2;

const SYMBOL_CANDIDATES: Record<string, string[]> = {
  XAUUSD: ["XAUUSD", "GOLD", "XAUUSD.r"],
  US30: ["DJ30.r", "DJ30", "US30", "US30.r"],
  NAS100: ["NAS100.r", "NAS100", "USTEC", "US100"],
  SPX500: ["SP500.r", "SP500", "US500", "SPX500"],
  GER40: ["GER40.r", "GER40", "DE40"],
};

type Ctx = { token: string; accountId: string; base: string; symbols: Set<string> };
let cached: { ctx: Ctx; at: number } | null = null;

function token() {
  return (process.env["METAAPI_TOKEN"] ?? "").replace(/\s+/g, "");
}

async function api(url: string, init: RequestInit = {}, tok = token()) {
  const res = await fetch(url, {
    ...init,
    headers: { "auth-token": tok, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.message ?? `MetaApi ${res.status}`);
  return body;
}

export function metaApiConfigured() {
  return !!token();
}

async function ctx(): Promise<Ctx> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.ctx;
  const tok = token();
  const wanted = (process.env["METAAPI_ACCOUNT_ID"] ?? "").trim().toLowerCase();
  const list: any[] = await api(PROV, {}, tok);
  const acc =
    list.find((a) => a._id === wanted) ??
    list.find((a) => String(a.name ?? "").toLowerCase().replace(/\s+/g, "") === wanted.replace(/\s+/g, "")) ??
    list[0];
  if (!acc) throw new Error("No hay cuentas en MetaApi");
  if (acc.state !== "DEPLOYED") {
    await api(`${PROV}/${acc._id}/deploy`, { method: "POST" }, tok);
    throw new Error("Encendiendo la cuenta en MetaApi, reintenta en un minuto");
  }
  const base = `https://mt-client-api-v1.${acc.region}.agiliumtrade.ai/users/current/accounts/${acc._id}`;
  const symbols: string[] = await api(`${base}/symbols`, {}, tok);
  const c = { token: tok, accountId: acc._id, base, symbols: new Set(symbols) };
  cached = { ctx: c, at: Date.now() };
  return c;
}

export async function brokerSymbol(symbol: string) {
  const c = await ctx();
  return (SYMBOL_CANDIDATES[symbol] ?? [symbol]).find((s) => c.symbols.has(s)) ?? null;
}

export async function accountInfo() {
  const c = await ctx();
  return api(`${c.base}/account-information`, {}, c.token) as Promise<{
    balance: number;
    equity: number;
    currency: string;
    login?: number;
    type: string;
  }>;
}

export type LiveOrderResult =
  | { ok: true; positionId: string; volume: number; bursts: number; brokerSymbol: string; entry: number }
  | { ok: false; reason: string };

export async function openLiveOrder(p: {
  symbol: string;
  side: "buy" | "sell";
  atr: number;
  slAtr: number;
  tpAtr: number;
  riskPct: number;
}): Promise<LiveOrderResult> {
  try {
    const c = await ctx();
    const sym = await brokerSymbol(p.symbol);
    if (!sym) return { ok: false, reason: `tu bróker no tiene ${p.symbol}` };
    const enc = encodeURIComponent(sym);
    const [spec, price] = await Promise.all([
      api(`${c.base}/symbols/${enc}/specification`, {}, c.token),
      api(`${c.base}/symbols/${enc}/current-price`, {}, c.token),
    ]);
    const isBuy = p.side === "buy";
    const entry = isBuy ? price.ask : price.bid;
    const point = Math.pow(10, -(spec.digits ?? 2));
    const minDist = ((spec.stopsLevel ?? 0) + 5) * point;
    const slDist = Math.max(p.slAtr * p.atr, minDist);
    const tpDist = Math.max(p.tpAtr * p.atr, minDist);
    const minVol = Number(spec.minVolume ?? 0.01);
    const volume = Math.max(FIXED_LOT, minVol);
    const vol = Number(volume.toFixed(2));
    const digits = spec.digits ?? 2;
    const stopLoss = Number((isBuy ? entry - slDist : entry + slDist).toFixed(digits));
    const takeProfit = Number((isBuy ? entry + tpDist : entry - tpDist).toFixed(digits));
    const ids: string[] = [];
    let lastErr = "el bróker rechazó la orden";
    for (let i = 0; i < BURSTS; i++) {
      try {
        const r = await api(
          `${c.base}/trade`,
          {
            method: "POST",
            body: JSON.stringify({
              actionType: isBuy ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL",
              symbol: sym,
              volume: vol,
              stopLoss,
              takeProfit,
              comment: `AMBAR ${i + 1}`,
            }),
          },
          c.token,
        );
        if (r?.positionId || r?.orderId) ids.push(String(r.positionId ?? r.orderId));
        else lastErr = r?.message ?? lastErr;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : lastErr;
      }
    }
    if (!ids.length) return { ok: false, reason: lastErr };
    return { ok: true, positionId: ids.join(","), volume: vol, bursts: ids.length, brokerSymbol: sym, entry };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "error con MetaApi" };
  }
}

export async function closeLivePosition(positionId: string) {
  try {
    const c = await ctx();
    await api(
      `${c.base}/trade`,
      { method: "POST", body: JSON.stringify({ actionType: "POSITION_CLOSE_ID", positionId }) },
      c.token,
    );
    return true;
  } catch {
    return false;
  }
}
