import { beforeEach, vi } from "vitest";
import { DEMO_NOW } from "./lib/demo/personas";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DEMO_NOW);
});
