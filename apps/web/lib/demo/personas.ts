import { live } from "./availability";
import { TEAM_OF, WORK_DAYS } from "./teams";
import type { Persona } from "./types";

const ORG_ID = "demo";
/** Folga só na terça (igual ao seed). */
const WEEKDAYS = WORK_DAYS;

/**
 * Personas da demonstração (docs/produto.md → "Personas da demonstração").
 * Dados SINTÉTICOS e provisórios até o `pnpm db:seed` da Frente 2 (hoje ainda um esqueleto).
 * Cidades, fusos e expedientes seguem o seed (seed/src/demo.ts).
 */

/**
 * Instante fixo usado só nos testes (03:12 em Fortaleza, 08:12 em Joanesburgo, 15:12 em Tóquio).
 * O painel usa o relógio real: a disponibilidade de cada persona sai do expediente (availability.ts).
 */
export const DEMO_NOW = new Date("2026-11-06T06:12:00Z");

export const PERSONAS: readonly Persona[] = (
  [
  {
    id: "fernando",
    name: "Fernando",
    title: "Desenvolvedor",
    story: "Dorme em Fortaleza enquanto Eduardo trabalha",
    role: "member",
    city: "Fortaleza",
    cityCode: "FOR",
    orgId: ORG_ID,
    active: true,
    skills: [],
    timezone: "America/Fortaleza",
    workHours: { days: WEEKDAYS, start: "09:00", end: "18:00" },
    areas: ["API v2", "pagamentos"],
    availability: { kind: "off", returns: "às 9h, horário de Fortaleza" },
  },
  {
    id: "eduardo",
    name: "Eduardo",
    title: "Desenvolvedor",
    story: "Na África do Sul, precisa saber se pode seguir",
    role: "member",
    city: "Joanesburgo",
    cityCode: "JNB",
    orgId: ORG_ID,
    active: true,
    skills: [],
    timezone: "Africa/Johannesburg",
    workHours: { days: WEEKDAYS, start: "08:00", end: "17:00" },
    areas: ["integrações", "pagamentos"],
    availability: { kind: "working" },
  },
  {
    id: "yan",
    name: "Yan",
    title: "Desenvolvedor",
    story: "Desenvolvedor da equipe",
    role: "member",
    city: "Tóquio",
    cityCode: "TYO",
    orgId: ORG_ID,
    active: true,
    skills: [],
    timezone: "Asia/Tokyo",
    workHours: { days: WEEKDAYS, start: "09:00", end: "18:00" },
    areas: [],
    availability: { kind: "vacation", until: "segunda" },
  },
  {
    id: "marina",
    name: "Marina",
    title: "Líder de engenharia",
    story: "Redistribui tarefas, vê custo e execuções",
    role: "leader",
    city: "São Paulo",
    cityCode: "SAO",
    orgId: ORG_ID,
    active: true,
    skills: [],
    timezone: "America/Sao_Paulo",
    workHours: { days: WEEKDAYS, start: "09:00", end: "18:00" },
    areas: ["gestão"],
    availability: { kind: "working" },
  },
  {
    id: "bruno",
    name: "Bruno",
    title: "Desenvolvedor",
    story: "Entra de férias e tem as tarefas redistribuídas",
    role: "member",
    city: "São Paulo",
    cityCode: "SAO",
    orgId: ORG_ID,
    active: true,
    skills: [],
    timezone: "America/Sao_Paulo",
    workHours: { days: WEEKDAYS, start: "09:00", end: "18:00" },
    areas: ["pagamentos"],
    availability: { kind: "working" },
  },
  {
    id: "carla",
    name: "Carla",
    title: "Desenvolvedora",
    story: "Poucos commits, 0 entregas e 5 ajudas a colegas",
    role: "member",
    city: "São Paulo",
    cityCode: "SAO",
    orgId: ORG_ID,
    active: true,
    skills: [],
    timezone: "America/Sao_Paulo",
    workHours: { days: WEEKDAYS, start: "09:00", end: "18:00" },
    areas: ["pagamentos"],
    availability: { kind: "working" },
  },
  {
    id: "rita",
    name: "Rita",
    title: "RH",
    story: "Vê o relatório enviado, sem nota, ranking ou cérebros",
    role: "hr",
    city: "São Paulo",
    cityCode: "SAO",
    orgId: ORG_ID,
    active: true,
    skills: [],
    timezone: "America/Sao_Paulo",
    workHours: { days: WEEKDAYS, start: "09:00", end: "18:00" },
    areas: [],
    availability: { kind: "working" },
  },
  ] as Persona[]
).map((p) => live({ ...p, teamId: TEAM_OF[p.id] }));

export function findPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
