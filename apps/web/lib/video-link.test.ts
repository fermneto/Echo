import { describe, expect, it } from "vitest";
import { signedVideoPath, VIDEO_LINK_TTL_S, verifyVideoLink } from "./video-link";

const SECRET = "s".repeat(40);
const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

describe("link assinado do vídeo", () => {
  const now = 1_800_000_000;
  const path = signedVideoPath(SECRET, ORG, ID, now);
  const q = new URL(path, "https://x").searchParams;

  it("vale para a empresa e o vídeo assinados, até expirar", () => {
    expect(path.startsWith(`/api/video/${ORG}/${ID}?`)).toBe(true);
    expect(verifyVideoLink(SECRET, ORG, ID, q.get("exp"), q.get("sig"), now + 10)).toBe(true);
    expect(verifyVideoLink(SECRET, ORG, ID, q.get("exp"), q.get("sig"), now + VIDEO_LINK_TTL_S + 1)).toBe(false);
  });

  it("outra empresa, outro vídeo, outro segredo ou validade mexida: recusado", () => {
    expect(verifyVideoLink(SECRET, "33333333-3333-4333-8333-333333333333", ID, q.get("exp"), q.get("sig"), now)).toBe(false);
    expect(verifyVideoLink(SECRET, ORG, "44444444-4444-4444-8444-444444444444", q.get("exp"), q.get("sig"), now)).toBe(false);
    expect(verifyVideoLink("t".repeat(40), ORG, ID, q.get("exp"), q.get("sig"), now)).toBe(false);
    expect(verifyVideoLink(SECRET, ORG, ID, String(Number(q.get("exp")) + 999), q.get("sig"), now)).toBe(false);
    expect(verifyVideoLink(SECRET, ORG, ID, null, null, now)).toBe(false);
  });
});
