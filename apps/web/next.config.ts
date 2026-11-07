import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // O monorepo inteiro entra no rastreio de arquivos do build standalone.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@echo/config", "@echo/connectors", "@echo/db", "@echo/domain", "@echo/agents", "@echo/jobs"],
  // Drivers do Postgres rodam como módulos do Node, fora do bundle.
  serverExternalPackages: ["pg", "pg-boss"],
  // A checagem de tipos roda com `pnpm typecheck` (TypeScript 7), fora do build.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
};

export default config;
