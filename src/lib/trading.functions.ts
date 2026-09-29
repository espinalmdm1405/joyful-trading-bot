import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { analyze, type Analysis } from "./indicators";
import { MARKETS, fetchCandles, marketBySymbol } from "./market.server";
import { aiRationale } from "./ai-analyst.server";
import { accountInfo, closeLivePosition, metaApiConfigured, openLiveOrder } from "./metaapi.server";

async function liveEnabled(supabase: any, userId: string) {
  if (!metaApiConfigured()) return false;
  const { data: conn } = await supabase
    .from("mt5_connections")
    .select("id, login, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn) return false;
  try {
    const info = await accountInfo();
    const match = String(info.login ?? "") === String(conn.login).trim();
    const status = match ? "connected" : "pending";
    if (conn.status !== status) await supabase.from("mt5_connections").update({ status }).eq("id", conn.id);
    return match;
  } catch {
    return false;
  }
}

export type MarketSnapshot = {
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  changePct: number;
  direction: "buy" | "sell" | "flat";
  confidence: number;
  rsi: number;
  atr: number;
  notes: string[];
  series: number[];
  error?: string;
};

const MAX_OPEN = 5;
const SL_ATR = 1.5;
const TP_ATR = 3;

async function snapshot(def: (typeof MARKETS)[number]): Promise<{
  snap: MarketSnapshot;
  analysis: Analysis | null;
}> {
  try {
    const candles = await fetchCandles(def.yahoo);
    const a = analyze(candles);
    if (!a) throw new Error("Historial insuficiente");
    return {
      analysis: a,
      snap: {
        symbol: def.symbol,
        name: def.name,
        decimals: def.decimals,
        price: a.price,
        changePct: a.changePct,
        direction: a.direction,
        confidence: a.confidence,
        rsi: a.rsi,
        atr: a.atr,
        notes: a.notes,
        series: candles.slice(-60).map((c) => c.c),
      },
    };
  } catch (error) {
    return {
      analysis: null,
      snap: {
        symbol: def.symbol,
        name: def.name,
        decimals: def.decimals,
        price: 0,
        changePct: 0,
        direction: "flat",
        confidence: 0,
        rsi: 50,
        atr: 0,
        notes: [],
        series: [],
        error: error instanceof Error ? error.message : "Sin datos",
      },
    };
  }
}

export const getMarkets = createServerFn({ method: "GET" }).handler(async () => {
  const results = await Promise.all(MARKETS.map((m) => snapshot(m)));
  return { markets: results.map((r) => r.snap) };
});

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    let { data: account } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!account) {
      const created = await supabase
        .from("accounts")
        .insert({ user_id: userId })
        .select("*")
        .single();
      account = created.data;
    }

    const [{ data: open }, { data: closed }, { data: logs }, { data: mt5 }] = await Promise.all([
      supabase
        .from("positions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "open")
        .order("opened_at", { ascending: false }),
      supabase
        .from("positions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(25),
      supabase
        .from("bot_logs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("mt5_connections")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      account,
      openPositions: open ?? [],
      closedPositions: closed ?? [],
      logs: logs ?? [],
      mt5: mt5 ?? null,
    };
  });

export const setBotEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await supabase
      .from("accounts")
      .update({ bot_enabled: data.enabled, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    await supabase.from("bot_logs").insert({
      user_id: userId,
      level: "info",
      message: data.enabled ? "Bot activado: empieza a buscar oportunidades." : "Bot detenido por el usuario.",
    });
    return { ok: true };
  });

export const setRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ riskPct: z.number().min(0.1).max(10) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const riskPct = Math.round(data.riskPct * 10) / 10;
    await supabase
      .from("accounts")
      .update({ risk_pct: riskPct, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    return { ok: true, riskPct };
  });

export const resetAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ balance: z.number().min(100).max(1000000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await supabase.from("positions").delete().eq("user_id", userId);
    await supabase.from("bot_logs").delete().eq("user_id", userId);
    await supabase
      .from("accounts")
      .update({
        balance: data.balance,
        start_balance: data.balance,
        bot_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return { ok: true };
  });

export const closePositionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { data: pos } = await supabase
      .from("positions")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .eq("status", "open")
      .maybeSingle();
    if (!pos) return { ok: false };

    const def = marketBySymbol(pos.symbol);
    if (!def) return { ok: false };
    const candles = await fetchCandles(def.yahoo);
    const price = candles[candles.length - 1]?.c ?? Number(pos.entry_price);
    const pnl = pnlOf(pos, price);
    if (pos.mt5_position_id) await closeLivePosition(pos.mt5_position_id);
    await settle(supabase, userId, pos, price, pnl, "Cierre manual");
    return { ok: true, pnl };
  });

function pnlOf(pos: any, price: number) {
  const dir = pos.side === "buy" ? 1 : -1;
  return (price - Number(pos.entry_price)) * Number(pos.size) * dir;
}

async function settle(
  supabase: any,
  userId: string,
  pos: any,
  price: number,
  pnl: number,
  reason: string,
) {
  await supabase
    .from("positions")
    .update({
      status: "closed",
      close_price: price,
      close_reason: reason,
      pnl,
      closed_at: new Date().toISOString(),
    })
    .eq("id", pos.id)
    .eq("user_id", userId);

  const { data: acc } = await supabase
    .from("accounts")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (acc) {
    await supabase
      .from("accounts")
      .update({ balance: Number(acc.balance) + pnl, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  await supabase.from("bot_logs").insert({
    user_id: userId,
    symbol: pos.symbol,
    level: pnl >= 0 ? "profit" : "loss",
    message: `${reason} en ${pos.symbol} a ${price.toFixed(2)}. Resultado: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`,
  });
}

export const runBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };

    const { data: account } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (!account) return { ok: false, reason: "sin-cuenta" };

    const snaps = await Promise.all(MARKETS.map((m) => snapshot(m)));
    const priceOf = new Map(snaps.map((s) => [s.snap.symbol, s.snap.price]));

    const { data: openPositions } = await supabase
      .from("positions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "open");

    let closedCount = 0;
    for (const pos of openPositions ?? []) {
      const price = priceOf.get(pos.symbol) ?? 0;
      if (!price) continue;
      const isBuy = pos.side === "buy";
      const hitTp = isBuy ? price >= Number(pos.take_profit) : price <= Number(pos.take_profit);
      const hitSl = isBuy ? price <= Number(pos.stop_loss) : price >= Number(pos.stop_loss);
      if (hitTp || hitSl) {
        await settle(
          supabase,
          userId,
          pos,
          hitTp ? Number(pos.take_profit) : Number(pos.stop_loss),
          pnlOf(pos, hitTp ? Number(pos.take_profit) : Number(pos.stop_loss)),
          hitTp ? "Objetivo alcanzado" : "Stop de protección",
        );
        closedCount++;
      }
    }

    if (!account.bot_enabled) {
      return { ok: true, opened: 0, closed: closedCount, paused: true };
    }

    const { data: stillOpen } = await supabase
      .from("positions")
      .select("id, symbol")
      .eq("user_id", userId)
      .eq("status", "open");

    const busy = new Set((stillOpen ?? []).map((p: any) => p.symbol));
    let slots = MAX_OPEN - (stillOpen?.length ?? 0);
    let opened = 0;
    const live = await liveEnabled(supabase, userId);

    const candidates = snaps
      .filter((s) => s.analysis && s.analysis.direction !== "flat" && !busy.has(s.snap.symbol))
      .sort((a, b) => (b.analysis?.confidence ?? 0) - (a.analysis?.confidence ?? 0));

    for (const c of candidates) {
      if (slots <= 0) break;
      const a = c.analysis;
      if (!a) continue;
      if (a.atr <= 0) continue;

      const { data: fresh } = await supabase
        .from("accounts")
        .select("balance, risk_pct")
        .eq("user_id", userId)
        .maybeSingle();
      const balance = Number(fresh?.balance ?? account.balance);
      const riskPct = Number(fresh?.risk_pct ?? account.risk_pct);
      if (balance <= 0) break;

      const isBuy = a.direction === "buy";
      const entry = a.price;
      const stop = isBuy ? entry - SL_ATR * a.atr : entry + SL_ATR * a.atr;
      const target = isBuy ? entry + TP_ATR * a.atr : entry - TP_ATR * a.atr;
      const riskAmount = (balance * riskPct) / 100;
      const distance = Math.abs(entry - stop);
      if (distance <= 0) continue;
      const size = riskAmount / distance;
      if (!Number.isFinite(size) || size <= 0) continue;

      const rationale = await aiRationale({
        symbol: c.snap.symbol,
        name: c.snap.name,
        analysis: a,
        entry,
        stopLoss: stop,
        takeProfit: target,
        riskPct,
      });

      let mt5Id: string | null = null;
      let liveNote = "";
      if (live) {
        const r = await openLiveOrder({
          symbol: c.snap.symbol,
          side: a.direction as "buy" | "sell",
          atr: a.atr,
          slAtr: SL_ATR,
          tpAtr: TP_ATR,
          riskPct,
        });
        if (r.ok) {
          mt5Id = r.positionId;
          liveNote = ` · MT5: ${r.volume} lotes de ${r.brokerSymbol}`;
        } else {
          await supabase.from("bot_logs").insert({
            user_id: userId,
            symbol: c.snap.symbol,
            level: "info",
            message: `MT5 no abrió ${c.snap.symbol}: ${r.reason}. Se omite la entrada.`,
          });
          continue;
        }
      }

      await supabase.from("positions").insert({
        mt5_position_id: mt5Id,
        user_id: userId,
        symbol: c.snap.symbol,
        side: a.direction,
        size,
        entry_price: entry,
        stop_loss: stop,
        take_profit: target,
        confidence: a.confidence,
        open_reason: rationale ?? a.notes.join(" · "),
      });

      await supabase.from("bot_logs").insert({
        user_id: userId,
        symbol: c.snap.symbol,
        level: "trade",
        message: `${isBuy ? "Compra" : "Venta"} en ${c.snap.symbol} a ${entry.toFixed(2)} · confianza ${a.confidence}%${liveNote} · ${rationale ?? a.notes[0]}`,
      });

      slots--;
      opened++;
    }

    if (opened === 0 && closedCount === 0) {
      const best = snaps.reduce(
        (acc, s) => Math.max(acc, s.analysis?.confidence ?? 0),
        0,
      );
      await supabase.from("bot_logs").insert({
        user_id: userId,
        level: "scan",
        message: `Análisis completado. Sin entradas de alta probabilidad (mejor señal ${best}%).`,
      });
    }

    return { ok: true, opened, closed: closedCount, paused: false };
  });

export const saveMt5Connection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        login: z.string().trim().min(3).max(40),
        server: z.string().trim().min(2).max(80),
        broker: z.string().trim().max(80).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await supabase.from("mt5_connections").delete().eq("user_id", userId);
    const { data: row } = await supabase
      .from("mt5_connections")
      .insert({ user_id: userId, ...data, status: "pending" })
      .select("*")
      .single();
    await supabase.from("bot_logs").insert({
      user_id: userId,
      level: "info",
      message: `Cuenta MT5 ${data.login} registrada en ${data.server}. Pendiente de activar el puente de ejecución real.`,
    });
    return { ok: true, connection: row };
  });
