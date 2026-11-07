// Resumos interativos (etapa 26): biblioteca FECHADA de componentes + especificação que o Claude devolve.
// Frente: Web/Visual renderiza; frente Funções gera a especificação; frente Avaliador testa o validador.
import { z } from "zod";

export const COMPONENTS = ["linha_do_dia", "cartao_tarefa", "cartao_pr", "lista_ordenavel", "quadro_liberado_reservado", "mapa_fusos", "barra_carga", "lista_pendencias"] as const;

/** Textos curtos sem números; números, datas e nomes entram pelo código via `factIds`. */
export const artifactSpecSchema = z.object({
  kind: z.enum(["nota", "plano", "resumo"]),
  blocks: z
    .array(
      z.object({
        component: z.enum(COMPONENTS),
        title: z.string().max(80).optional(),
        text: z.string().max(280).optional(),
        factIds: z.array(z.string()).default([]),
      }),
    )
    .max(12),
});
export type ArtifactSpec = z.infer<typeof artifactSpecSchema>;
