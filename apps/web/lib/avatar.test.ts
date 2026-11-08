import { inflateSync } from "node:zlib";
import { composeSprite, traitsFromSeed } from "@echo/domain";
import { describe, expect, it } from "vitest";
import { avatarResponse, echoAvatarResponse } from "./avatar";
import { spritePng } from "./sprite-png";

const ORG = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";

function size(png: Buffer) {
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

describe("PNG do bonequinho", () => {
  it("PNG válido, quadrado, ampliado sem suavizar", () => {
    const png = spritePng(composeSprite(traitsFromSeed("x")), { scale: 4 });
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(size(png)).toEqual({ w: (24 + 8) * 4, h: (24 + 8) * 4 });
    // Os dados descomprimem para (largura × 4 + 1) × altura bytes.
    const idat = png.indexOf("IDAT");
    const len = png.readUInt32BE(idat - 4);
    expect(inflateSync(png.subarray(idat + 4, idat + 4 + len))).toHaveLength((128 * 4 + 1) * 128);
  });
  it("busto: só cabeça e ombros, começando na primeira linha desenhada", () => {
    const bust = spritePng(composeSprite({ ...traitsFromSeed("x"), hair: "buzz", headwear: "none" }), { scale: 1, view: "bust" });
    expect(size(bust).w).toBe(size(bust).h);
    expect(size(bust).w).toBeLessThan(24);
  });
});

describe("rota do bonequinho", () => {
  it("pessoa da empresa: PNG com cache longo quando o endereço tem versão", async () => {
    const res = await avatarResponse(ORG, PERSON, async () => ({ hair: "afro" }), true);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });
  it("id inválido ou pessoa de fora: 404, sem consultar o banco à toa", async () => {
    let reads = 0;
    const read = async () => (reads++, undefined);
    expect((await avatarResponse("demo", PERSON, read, false)).status).toBe(404);
    expect(reads).toBe(0);
    expect((await avatarResponse(ORG, PERSON, read, false)).status).toBe(404);
  });
  it("o Echo tem ícone próprio", async () => {
    expect(echoAvatarResponse().headers.get("content-type")).toBe("image/png");
  });
});
