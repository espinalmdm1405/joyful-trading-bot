// Calendario de noticias económicas de alto impacto (gratuito, semanal).
type Ev = { title: string; country: string; date: string; impact: string };
let cache: { at: number; events: Ev[] } | null = null;

async function events(): Promise<Ev[]> {
  if (cache && Date.now() - cache.at < 30 * 60_000) return cache.events;
  try {
    const r = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error(String(r.status));
    const list = (await r.json()) as Ev[];
    cache = { at: Date.now(), events: list.filter((e) => e.impact === "High") };
  } catch {
    if (!cache) return [];
  }
  return cache!.events;
}

// Monedas que mueven cada mercado. El dólar afecta a todos.
function currenciesFor(symbol: string): string[] {
  const s = symbol.toUpperCase();
  const out = new Set(["USD"]);
  for (const c of ["EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"]) if (s.includes(c)) out.add(c);
  if (s.includes("DAX") || s.includes("GER")) out.add("EUR");
  return [...out];
}

/** Devuelve la noticia fuerte cercana (30 min antes / 30 min después) o null. */
export async function highImpactNear(symbol: string): Promise<string | null> {
  const now = Date.now();
  const cur = currenciesFor(symbol);
  for (const e of await events()) {
    if (!cur.includes(e.country)) continue;
    const t = new Date(e.date).getTime();
    if (now > t - 30 * 60_000 && now < t + 30 * 60_000) return `${e.country} ${e.title}`;
  }
  return null;
}
