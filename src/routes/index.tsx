import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  LineChart,
  LogOut,
  Plug,
  RefreshCw,
  ShieldCheck,
  Loader2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Sparkline } from "@/components/Sparkline";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  getDashboard,
  getLiveAccount,
  getMarkets,
  runBot,
  setBotEnabled,
  setRisk,
  closePositionNow,
  resetAccount,
} from "@/lib/trading.functions";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "AMBAR · Bot de trading automático de oro e índices" },
      {
        name: "description",
        content:
          "Bot que analiza oro e índices, abre y cierra operaciones solo, con riesgo por operación ajustable y conexión a MetaTrader 5.",
      },
      { property: "og:title", content: "AMBAR · Bot de trading automático" },
      {
        property: "og:description",
        content:
          "Analiza oro e índices, opera solo y cierra con objetivo automático. Riesgo ajustable.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const money = (n: number) =>
  n.toLocaleString("es-DO", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function Dashboard() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const dashboardFn = useServerFn(getDashboard);
  const marketsFn = useServerFn(getMarkets);
  const runBotFn = useServerFn(runBot);
  const toggleFn = useServerFn(setBotEnabled);
  const riskFn = useServerFn(setRisk);
  const closeFn = useServerFn(closePositionNow);
  const resetFn = useServerFn(resetAccount);

  const [riskDraft, setRiskDraft] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const riskTouched = useRef(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const markets = useQuery({
    queryKey: ["markets"],
    queryFn: () => marketsFn(),
    enabled: !!session,
    refetchInterval: 60_000,
  });

  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => dashboardFn(),
    enabled: !!session,
    refetchInterval: 30_000,
  });

  const liveFn = useServerFn(getLiveAccount);
  const live = useQuery({
    queryKey: ["live-account"],
    queryFn: () => liveFn(),
    enabled: !!session,
    refetchInterval: 30_000,
  });

  // Avisos: cuando AMBAR abre o cierra una operación.
  const seenLogs = useRef<Set<string> | null>(null);
  useEffect(() => {
    const list = (dash.data?.logs ?? []) as any[];
    if (!dash.data) return;
    if (!seenLogs.current) {
      seenLogs.current = new Set(list.map((l) => l.id));
      return;
    }
    for (const l of [...list].reverse()) {
      if (seenLogs.current.has(l.id)) continue;
      seenLogs.current.add(l.id);
      if (!["trade", "profit", "loss"].includes(l.level)) continue;
      const title = l.level === "trade" ? "AMBAR abrió una operación" : "AMBAR cerró una operación";
      if (l.level === "loss") toast.error(title, { description: l.message });
      else toast.success(title, { description: l.message });
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification(title, { body: l.message }); } catch { /* móvil */ }
      }
    }
  }, [dash.data]);

  const account = dash.data?.account;
  const botOn = !!account?.bot_enabled;
  const risk = riskDraft ?? Number(account?.risk_pct ?? 0.5);

  async function tick(manual = false) {
    if (scanning) return;
    setScanning(true);
    try {
      const r = await runBotFn();
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      await qc.invalidateQueries({ queryKey: ["markets"] });
      if (manual) {
        toast.success(
          r.opened || r.closed
            ? `Análisis listo: ${r.opened} entrada(s), ${r.closed} cierre(s).`
            : "Análisis listo. Sin oportunidades de alta probabilidad ahora.",
        );
      }
    } catch (error) {
      if (manual) toast.error("No se pudo completar el análisis.");
      console.error(error);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (!session || !botOn) return;
    void tick();
    const id = setInterval(() => void tick(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, botOn]);

  if (loading || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    );
  }

  const balance = Number(account?.balance ?? 0);
  const start = Number(account?.start_balance ?? 0);
  const pl = balance - start;
  const plPct = start ? (pl / start) * 100 : 0;
  const open = dash.data?.openPositions ?? [];
  const closed = dash.data?.closedPositions ?? [];
  const logs = dash.data?.logs ?? [];
  const wins = closed.filter((p: any) => Number(p.pnl) > 0).length;
  const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;
  const priceOf = (s: string) =>
    markets.data?.markets.find((m) => m.symbol === s)?.price ?? 0;

  const weekRows = dash.data?.weekClosed ?? [];
  const weekNet = weekRows.reduce((s: number, p: any) => s + Number(p.pnl), 0);
  const weekWins = weekRows.filter((p: any) => Number(p.pnl) > 0).length;
  const weekLosses = weekRows.length - weekWins;
  const dayLabels = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(today);
    start.setDate(today.getDate() - (6 - i));
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    const pnl = weekRows
      .filter((p: any) => {
        const t = new Date(p.closed_at);
        return t >= start && t < end;
      })
      .reduce((s: number, p: any) => s + Number(p.pnl), 0);
    return { label: dayLabels[start.getDay()], pnl };
  });
  const maxAbs = Math.max(...perDay.map((d) => Math.abs(d.pnl)), 1e-6);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 sm:px-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LineChart className="size-5 text-primary" />
          <span className="font-display text-base font-semibold tracking-tight">AMBAR</span>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to="/conectar">
              <Plug className="size-4" /> MT5
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Cerrar sesión"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {/* Capital */}
      <section className="panel mt-5 p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Capital simulado</p>
        <p className="tabular mt-1 text-4xl font-semibold gold-text">{money(balance)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className={pl >= 0 ? "text-profit" : "text-loss"}>
            {pl >= 0 ? "+" : ""}
            {money(pl)} ({plPct >= 0 ? "+" : ""}
            {plPct.toFixed(2)}%)
          </span>
          <span className="text-muted-foreground">
            {closed.length} cerradas · {winRate}% acierto
          </span>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Bot className={botOn ? "size-5 text-primary" : "size-5 text-muted-foreground"} />
            <div>
              <p className="text-sm font-medium">Bot automático</p>
              <p className="text-xs text-muted-foreground">
                {botOn
                  ? scanning
                    ? "Analizando el mercado…"
                    : "Operando solo cada minuto"
                  : "Detenido"}
              </p>
            </div>
          </div>
          <Switch
            checked={botOn}
            onCheckedChange={async (v) => {
              await toggleFn({ data: { enabled: v } });
              await qc.invalidateQueries({ queryKey: ["dashboard"] });
              if (v) void tick();
            }}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={scanning}
            onClick={() => void tick(true)}
          >
            {scanning ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Analizar ahora
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await resetFn({ data: { balance: 10000 } });
              await qc.invalidateQueries({ queryKey: ["dashboard"] });
              toast.success("Cuenta reiniciada a 10.000 USD.");
            }}
          >
            Reiniciar
          </Button>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-xs">
          <span className="text-muted-foreground">Operaciones simultáneas</span>
          <span className="tabular font-medium text-foreground">{open.length} de 2 activas</span>
        </div>
      </section>

      {/* Cuenta real */}
      <section className="panel mt-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <p className="text-sm font-medium">Tu cuenta real (MetaTrader 5)</p>
          </div>
          {typeof Notification !== "undefined" && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const p = await Notification.requestPermission();
                toast[p === "granted" ? "success" : "error"](
                  p === "granted" ? "Avisos activados." : "Tu navegador no permitió los avisos.",
                );
              }}
            >
              Activar avisos
            </Button>
          )}
        </div>
        {live.data?.connected ? (
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Saldo real</p>
              <p className="tabular text-lg font-semibold">{live.data.balance.toFixed(2)} {live.data.currency}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Con operaciones abiertas</p>
              <p className={`tabular text-lg font-semibold ${live.data.equity >= live.data.balance ? "text-primary" : "text-destructive"}`}>
                {live.data.equity.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Riesgo por operación</p>
              <p className="tabular text-lg font-semibold">{live.data.riskPct.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Frena si baja de</p>
              <p className="tabular text-lg font-semibold">{live.data.brakeAt.toFixed(2)}</p>
            </div>
            <p className={`col-span-full text-xs ${live.data.braked ? "text-destructive" : "text-muted-foreground"}`}>
              {live.data.braked
                ? "Freno activo: la cuenta va perdiendo más del 3%, AMBAR no abre nuevas operaciones hasta que se recupere."
                : "Todo normal: AMBAR frena solo si la cuenta pierde más del 3% con las operaciones abiertas."}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {live.isLoading ? "Consultando tu cuenta…" : "No se pudo leer la cuenta real ahora mismo."}
          </p>
        )}
      </section>

      {/* Resultados de la semana */}
      <section className="panel mt-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <p className="text-sm font-medium">Resultados de la semana</p>
          </div>
          <span
            className={`tabular text-lg font-semibold ${weekNet >= 0 ? "text-profit" : "text-loss"}`}
          >
            {weekNet >= 0 ? "+" : ""}
            {money(weekNet)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {weekRows.length} operaciones cerradas · {weekWins} ganadoras · {weekLosses} perdedoras
          {weekRows.length > 0 &&
            ` · ${Math.round((weekWins / weekRows.length) * 100)}% de acierto`}
        </p>
        <div className="mt-4 flex h-20 items-end justify-between gap-1.5">
          {perDay.map((d, i) => {
            const h = Math.max((Math.abs(d.pnl) / maxAbs) * 100, d.pnl === 0 ? 3 : 8);
            return (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span
                  className={`tabular text-[10px] ${d.pnl === 0 ? "text-muted-foreground" : d.pnl > 0 ? "text-profit" : "text-loss"}`}
                >
                  {d.pnl === 0
                    ? "—"
                    : `${d.pnl > 0 ? "+" : ""}${d.pnl.toFixed(2)}`}
                </span>
                <div
                  className={`w-full rounded-sm ${d.pnl === 0 ? "bg-surface-2" : d.pnl > 0 ? "bg-profit" : "bg-loss"}`}
                  style={{ height: `${h}%` }}
                />
                <span className="text-[10px] text-muted-foreground">{d.label}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Juzga el trabajo del bot por esta línea semanal, no por cada operación suelta: es normal
          que suba y baje dentro del mismo día.
        </p>
      </section>

      {/* Riesgo */}
      <section className="panel mt-4 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <p className="text-sm font-medium">Riesgo por operación</p>
          </div>
          <span className="tabular text-lg font-semibold text-primary">{risk.toFixed(1)}%</span>
        </div>
        <Slider
          className="mt-4"
          min={0.1}
          max={10}
          step={0.1}
          value={[risk]}
          onValueChange={(v) => {
            riskTouched.current = true;
            setRiskDraft(v[0] ?? 0.5);
          }}
          onValueCommit={async (v) => {
            const next = v[0] ?? 0.5;
            await riskFn({ data: { riskPct: next } });
            await qc.invalidateQueries({ queryKey: ["dashboard"] });
            toast.success(`Riesgo ajustado a ${next.toFixed(1)}% por operación.`);
          }}
        />
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>Conservador 0.1%</span>
          <span>Muy agresivo 10%</span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Con este ajuste el bot arriesga {money((balance * risk) / 100)} como máximo en cada
          operación, y siempre busca el doble de ganancia que de pérdida.
        </p>
        {risk >= 5 && (
          <p className="mt-3 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
            Riesgo alto: con varias operaciones abiertas, las pérdidas pueden acumularse rápidamente.
          </p>
        )}
      </section>

      {/* Mercados */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Mercados vigilados
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(markets.data?.markets ?? []).map((m) => (
            <article key={m.symbol} className="panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-sm font-semibold">{m.symbol}</p>
                  <p className="text-xs text-muted-foreground">{m.name}</p>
                </div>
                <div className="text-right">
                  <p className="tabular text-sm font-semibold">
                    {m.price ? m.price.toFixed(m.decimals) : "—"}
                  </p>
                  <p
                    className={`tabular text-xs ${m.changePct >= 0 ? "text-profit" : "text-loss"}`}
                  >
                    {m.changePct >= 0 ? "+" : ""}
                    {m.changePct.toFixed(2)}%
                  </p>
                </div>
              </div>
              <Sparkline points={m.series} up={m.changePct >= 0} />
              <div className="mt-2 flex items-center justify-between">
                <Badge
                  variant="outline"
                  className={
                    m.direction === "buy"
                      ? "border-profit/40 text-profit"
                      : m.direction === "sell"
                        ? "border-loss/40 text-loss"
                        : "text-muted-foreground"
                  }
                >
                  {m.direction === "buy"
                    ? "Señal de compra"
                    : m.direction === "sell"
                      ? "Señal de venta"
                      : "Sin señal clara"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {m.error ? m.error : `Confianza ${m.confidence}%`}
                </span>
              </div>
            </article>
          ))}
          {markets.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando precios…</p>
          )}
        </div>
      </section>

      {/* Operaciones abiertas */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Operaciones abiertas
        </h2>
        {open.length === 0 ? (
          <p className="panel p-5 text-sm text-muted-foreground">
            No hay operaciones abiertas. El bot entra solo cuando la probabilidad es alta.
          </p>
        ) : (
          <div className="space-y-3">
            {open.map((p: any) => {
              const live = priceOf(p.symbol) || Number(p.entry_price);
              const pnl =
                (live - Number(p.entry_price)) * Number(p.size) * (p.side === "buy" ? 1 : -1);
              return (
                <article key={p.id} className="panel p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {p.side === "buy" ? (
                        <ArrowUpRight className="size-4 text-profit" />
                      ) : (
                        <ArrowDownRight className="size-4 text-loss" />
                      )}
                      <span className="font-display text-sm font-semibold">{p.symbol}</span>
                      <Badge variant="secondary">{p.side === "buy" ? "Compra" : "Venta"}</Badge>
                    </div>
                    <span
                      className={`tabular text-sm font-semibold ${pnl >= 0 ? "text-profit" : "text-loss"}`}
                    >
                      {pnl >= 0 ? "+" : ""}
                      {money(pnl)}
                    </span>
                  </div>
                  <dl className="tabular mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Entrada</dt>
                      <dd>{Number(p.entry_price).toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Stop</dt>
                      <dd className="text-loss">{Number(p.stop_loss).toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Objetivo</dt>
                      <dd className="text-profit">{Number(p.take_profit).toFixed(2)}</dd>
                    </div>
                  </dl>
                  {p.open_reason && (
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      {p.open_reason}
                    </p>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 px-0 text-xs"
                    onClick={async () => {
                      await closeFn({ data: { id: p.id } });
                      await qc.invalidateQueries({ queryKey: ["dashboard"] });
                      toast.success("Operación cerrada.");
                    }}
                  >
                    Cerrar ahora
                  </Button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Historial */}
      {closed.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Últimos cierres
          </h2>
          <div className="panel divide-y divide-border">
            {closed.slice(0, 8).map((p: any) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {p.symbol} · {p.side === "buy" ? "Compra" : "Venta"}
                  </p>
                  <p className="text-xs text-muted-foreground">{p.close_reason}</p>
                </div>
                <span
                  className={`tabular text-sm font-semibold ${Number(p.pnl) >= 0 ? "text-profit" : "text-loss"}`}
                >
                  {Number(p.pnl) >= 0 ? "+" : ""}
                  {money(Number(p.pnl))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Registro */}
      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-muted-foreground">
          <Activity className="size-4" /> Diario del bot
        </h2>
        <div className="panel p-4">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Enciende el bot para ver aquí cada decisión que toma.
            </p>
          ) : (
            <ul className="space-y-3">
              {logs.slice(0, 12).map((l: any) => (
                <li key={l.id} className="flex gap-3 text-xs">
                  <span
                    className={`mt-1 size-1.5 shrink-0 rounded-full ${
                      l.level === "profit"
                        ? "bg-profit"
                        : l.level === "loss"
                          ? "bg-loss"
                          : l.level === "trade"
                            ? "bg-primary"
                            : "bg-muted-foreground"
                    }`}
                  />
                  <div>
                    <p className="leading-relaxed">{l.message}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {new Date(l.created_at).toLocaleString("es-DO")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
        El bot opera con capital simulado usando precios reales del mercado. Operar conlleva riesgo
        de pérdida; los resultados pasados no garantizan resultados futuros.
      </p>
    </main>
  );
}
