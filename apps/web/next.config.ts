import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // O monorepo inteiro entra no rastreio de arquivos do build standalone.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@echo/config", "@echo/connectors", "@echo/db", "@echo/domain", "@echo/agents", "@echo/artifacts", "@echo/jobs", "@echo/brain", "@echo/actions", "@echo/observability"],
  // Drivers do Postgres rodam como módulos do Node, fora do bundle.
  serverExternalPackages: ["pg", "pg-boss"],
  // A checagem de tipos roda com `pnpm typecheck` (TypeScript 7), fora do build.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
  // Cadastro do RH envia foto (até 4 MB) e currículo em PDF (até 2 MB) pela ação do servidor; o padrão é 1 MB.
  // A landing era em /landing: link antigo compartilhado continua chegando nela.
  redirects: async () => [{ source: "/landing", destination: "/", permanent: true }],
  experimental: { serverActions: { bodySizeLimit: "7mb" } },
};

export default config;
