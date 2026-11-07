// Empresa de demonstração (etapa 2, frente Funções). `pnpm db:seed` roda src/cli.ts.
// Personas: Fernando (Fortaleza), Eduardo (África do Sul), Yan (Tóquio), Marina (líder), Bruno (sai de férias),
// Carla (5 ajudas), Rita (RH). Só dados sintéticos.
export { buildDemo, DEMO_IDS, DEMO_REPO, localDate, type DemoData, type PersonaKey } from "./demo.ts";
export { resetDemo, type ResetSummary } from "./reset.ts";
