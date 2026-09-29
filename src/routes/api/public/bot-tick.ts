import { createFileRoute } from "@tanstack/react-router";

// Reloj automático: el servidor ejecuta el bot cada minuto aunque la app esté cerrada.
export const Route = createFileRoute("/api/public/bot-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const token = request.headers.get("x-cron-token") ?? "";
        const { data: row } = await supabaseAdmin.from("cron_tokens" as any).select("token").eq("name", "bot").maybeSingle();
        if (!token || !row || (row as any).token !== token) return new Response("Unauthorized", { status: 401 });

        const { botCycle } = await import("@/lib/trading.functions");
        const { data: accounts } = await supabaseAdmin.from("accounts").select("user_id").eq("bot_enabled", true);
        const results: unknown[] = [];
        for (const a of accounts ?? []) {
          try {
            results.push(await botCycle(supabaseAdmin, a.user_id));
          } catch (e) {
            results.push({ ok: false, error: String(e) });
          }
        }
        return Response.json({ ran: results.length });
      },
    },
  },
});
