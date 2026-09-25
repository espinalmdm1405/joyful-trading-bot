import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, Plug } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { getDashboard, saveMt5Connection } from "@/lib/trading.functions";

export const Route = createFileRoute("/conectar")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Conectar MetaTrader 5 · AuriBot" },
      {
        name: "description",
        content:
          "Registra tu cuenta de MetaTrader 5 para que el bot ejecute sus operaciones en tu bróker.",
      },
      { property: "og:title", content: "Conectar MetaTrader 5 · AuriBot" },
      {
        property: "og:description",
        content: "Registra tu cuenta de MetaTrader 5 para operar en tu bróker.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConnectPage,
});

function ConnectPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const dashboardFn = useServerFn(getDashboard);
  const saveFn = useServerFn(saveMt5Connection);

  const [login, setLogin] = useState("");
  const [server, setServer] = useState("");
  const [broker, setBroker] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => dashboardFn(),
    enabled: !!session,
  });
  const mt5 = dash.data?.mt5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await saveFn({ data: { login, server, broker } });
      await qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Cuenta registrada.");
      setLogin("");
      setServer("");
      setBroker("");
    } catch {
      toast.error("No se pudo guardar la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-20 pt-5 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/">
          <ArrowLeft className="size-4" /> Volver
        </Link>
      </Button>

      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
        Conectar MetaTrader 5
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Mientras tanto el bot ya opera solo con precios reales y capital simulado. Para que envíe
        las órdenes a tu bróker hace falta un puente autorizado que hable con MetaTrader 5.
      </p>

      {mt5 && (
        <div className="panel mt-5 flex items-start gap-3 p-4">
          <CheckCircle2 className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="text-sm font-medium">
              Cuenta {mt5.login} · {mt5.server}
            </p>
            <p className="text-xs text-muted-foreground">{mt5.broker || "Bróker sin especificar"}</p>
            <Badge variant="outline" className="mt-2 border-primary/40 text-primary">
              Pendiente de activar el puente
            </Badge>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="panel mt-5 space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Plug className="size-4 text-primary" />
          <p className="text-sm font-medium">Datos de tu cuenta</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="login">Número de cuenta</Label>
          <Input
            id="login"
            required
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="Ej. 51234567"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="server">Servidor</Label>
          <Input
            id="server"
            required
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="Ej. ICMarketsSC-Demo"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="broker">Bróker (opcional)</Label>
          <Input
            id="broker"
            value={broker}
            onChange={(e) => setBroker(e.target.value)}
            placeholder="Ej. IC Markets"
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Guardar cuenta
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Nunca pedimos la contraseña de tu cuenta en este formulario. La clave de operaciones se
          guarda aparte, cifrada, cuando activemos el puente de ejecución real.
        </p>
      </form>
    </main>
  );
}
