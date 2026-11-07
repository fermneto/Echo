import { ROUTES, type RouteId } from "@/lib/access";

/** Tela reservada: a rota e a permissão já valem, o conteúdo chega na etapa indicada. */
export function EmBreve({ route, etapa, what }: { route: RouteId; etapa: string; what: string }) {
  return (
    <>
      <h1 className="app-title">{ROUTES[route].label}</h1>
      <p className="lead">{what}</p>
      <p className="status-tag mono">
        <span className="dot dot--off" aria-hidden="true" />
        Etapa {etapa}
      </p>
    </>
  );
}
