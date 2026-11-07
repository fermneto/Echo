// Atividade sintética no Linear de teste, para ensaiar a nota do dia de quem não trabalhou nas últimas 24 h.
// Para cada pessoa: uma tarefa em andamento (com comentário) e uma concluída, com a pessoa como responsável.
// O Linear avisa o Echo pelo webhook (e a reconciliação recupera a concluída). Só dados sintéticos.
// Uso: pnpm integracoes:atividade Yan Eduardo
import { LinearTracker } from "./linear-client.ts";

const names = process.argv.slice(2);
if (!names.length) {
  console.error("Diga de quem: pnpm integracoes:atividade Yan Eduardo");
  process.exit(1);
}
const { LINEAR_CLIENT_ID: clientId, LINEAR_CLIENT_SECRET: clientSecret, LINEAR_API_KEY: apiKey } = process.env;
if (!apiKey && (!clientId || !clientSecret)) {
  console.error("Defina LINEAR_API_KEY (ou LINEAR_CLIENT_ID e LINEAR_CLIENT_SECRET) no .env.");
  process.exit(1);
}
const linear = new LinearTracker(apiKey ? { token: apiKey } : { clientId: clientId!, clientSecret: clientSecret! });

const PLANS: { started: string; done: string; comment: string }[] = [
  { started: "Validação do formulário de cadastro", done: "Texto do e-mail de boas-vindas", comment: "Validação dos campos obrigatórios pronta; falta a mensagem de erro do CPF." },
  { started: "Exportar relatório de pedidos em CSV", done: "Mensagens de erro da API de pedidos", comment: "Exportação funcionando; falta tratar pedidos sem cliente." },
  { started: "Filtro por data no histórico", done: "Ordenação da lista de clientes", comment: "Filtro pronto no back; falta o seletor de datas na tela." },
];

type Team = { id: string; key: string; name: string; states: { nodes: { id: string; name: string; type: string }[] } };
const { teams } = await linear.query<{ teams: { nodes: Team[] } }>("query { teams(first: 10) { nodes { id key name states { nodes { id name type } } } } }");
const team = teams.nodes.find((t) => t.key === process.env.LINEAR_TEAM_KEY) ?? teams.nodes[0];
if (!team) throw new Error("Nenhum time no Linear");
const state = (type: string) => team.states.nodes.find((s) => s.type === type);
const started = state("started");
const completed = state("completed");
if (!started || !completed) throw new Error(`Time ${team.key} sem estado "started" ou "completed"`);

const users = await linear.listUsers();
const create = async (title: string, assigneeId: string, stateId: string) => {
  const d = await linear.query<{ issueCreate: { success: boolean; issue: { id: string; identifier: string } } }>(
    "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier } } }",
    { input: { teamId: team.id, title, assigneeId, stateId, description: "Atividade sintética para ensaiar a nota do dia do Echo." } },
  );
  if (!d.issueCreate.success) throw new Error(`Falha ao criar "${title}"`);
  return d.issueCreate.issue;
};

console.log(`Time ${team.key} · ${team.name}`);
for (const [i, name] of names.entries()) {
  const user = users.find((u) => u.name.toLowerCase().includes(name.toLowerCase()));
  if (!user) {
    console.log(`  ${name}: não encontrado entre as pessoas do Linear (${users.map((u) => u.name).join(", ")})`);
    continue;
  }
  const plan = PLANS[i % PLANS.length]!;
  const a = await create(plan.started, user.id, started.id);
  await linear.comment(a.id, plan.comment);
  const b = await create(plan.done, user.id, completed.id);
  console.log(`  ${user.name}: ${a.identifier} em andamento (com comentário) · ${b.identifier} concluída`);
}
