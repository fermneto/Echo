/**
 * Token com renovação central: guarda até perto de vencer e, se vários pedidos chegarem juntos,
 * só um vai buscar o token novo (os outros esperam o mesmo resultado). Uma trava por instalação.
 */
export class RefreshingToken {
  private value: { token: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly fetchToken: () => Promise<{ token: string; expiresAt: number }>,
    /** Renova com esta folga antes do vencimento. */
    private readonly marginMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(): Promise<string> {
    if (this.value && this.value.expiresAt - this.marginMs > this.now()) return Promise.resolve(this.value.token);
    this.pending ??= this.fetchToken()
      .then((v) => {
        this.value = v;
        return v.token;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /** Esquece o token (por exemplo, depois de um 401), forçando a próxima busca. */
  invalidate(): void {
    this.value = null;
  }
}
