import { describe, expect, it } from "vitest";
import { DEMO_NOW } from "./demo/personas";
import { localTime } from "./time";

describe("localTime", () => {
  it("mostra o instante da cena 1 em cada fuso", () => {
    expect(localTime(DEMO_NOW, "America/Fortaleza")).toBe("03:12");
    expect(localTime(DEMO_NOW, "Africa/Johannesburg")).toBe("08:12");
    expect(localTime(DEMO_NOW, "Asia/Tokyo")).toBe("15:12");
  });
});
