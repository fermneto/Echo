/** Relógio trocável: permite simular a noite e testar fusos sem esperar. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Relógio de teste: parado num instante, avançável à mão. */
export class FixedClock implements Clock {
  private t: number;
  constructor(at: Date | string) {
    this.t = new Date(at).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(at: Date | string): void {
    this.t = new Date(at).getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
