import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // O painel usa o relógio real; os testes fixam o instante da demo para serem determinísticos.
    setupFiles: ["./vitest.setup.ts"],
  },
});
