import type { AccountValues } from "@/components/AccountFields";

/** Estado do formulário de contas na ficha (sem dependência de servidor). */
export type ContasState = { status: "idle" } | { status: "error"; error: string } | { status: "saved"; values: AccountValues };
