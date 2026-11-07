// Custo de uma chamada ao modelo, pelos preços da Calculadora de custo (US$ por milhão de tokens).
// Escrita de cache custa 1,25× a entrada; leitura de cache, 0,1×.
export interface Usage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

/** Modelo desconhecido (ex.: reencaminhado pelo servidor) usa o preço mais alto da tabela, para não subestimar. */
const FALLBACK_PRICE = { input: 4, output: 20 };

export function modelCostUsd(model: string, u: Usage): number {
  const p = PRICES_PER_MTOK[model] ?? FALLBACK_PRICE;
  const input = u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1;
  return Math.round(((input * p.input + u.output * p.output) / 1_000_000) * 1e6) / 1e6;
}
