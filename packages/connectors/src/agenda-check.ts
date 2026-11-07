// Confere a agenda de uma pessoa e mostra o que o Echo lê (só fora do escritório e expediente).
// Uso: pnpm --filter @echo/connectors agenda:check <e-mail> [google|microsoft]
import { platformsFromEnv } from "./platforms.ts";

const [user, which] = process.argv.slice(2).filter((x) => x !== "--");
if (!user) {
  console.error("Uso: pnpm --filter @echo/connectors agenda:check <e-mail> [google|microsoft]");
  process.exit(1);
}
const p = platformsFromEnv(process.env);
const tenant = process.env.DEMO_MICROSOFT_TENANT_ID;
const cal = which === "microsoft" || (!which && !p.google) ? (p.microsoft && tenant ? p.microsoft(tenant) : null) : (p.google ?? null);
if (!cal) {
  console.error("Agenda não configurada: GOOGLE_SERVICE_ACCOUNT_* ou MICROSOFT_CLIENT_* e DEMO_MICROSOFT_TENANT_ID no .env.");
  process.exit(1);
}
const now = new Date();
try {
  const events = await cal.listOutOfOffice(user, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 60 * 86_400_000));
  console.log(`${cal.provider}: ${events.length} períodos de fora do escritório nos próximos 60 dias (só id e horário):`);
  for (const e of events) console.log(`  ${e.start.toISOString()} → ${e.end.toISOString()}  (${e.id.slice(0, 24)})`);
  const h = await cal.workingHours(user);
  console.log(h ? `Expediente na agenda: ${h.start}–${h.end}, dias ${h.days.join(",")}, ${h.timezone}` : "Expediente: a agenda não informa (Google) ou não está definido.");
} catch (err) {
  console.error(`Falha ao ler a agenda de ${user}:`, err instanceof Error ? err.message : err);
  console.error("Google: confira a delegação no domínio (Admin → Segurança → Controles de API) com o escopo calendar.events.readonly.");
  console.error("Microsoft: confira o consentimento do administrador para Calendars.ReadBasic e MailboxSettings.Read.");
  process.exit(1);
}
