import { deflateSync } from "node:zlib";
import type { SpritePixels } from "@echo/domain";

/** Linhas do sprite que formam o busto (cabeça e ombros), o recorte que se lê bem num ícone pequeno. */
export const BUST_ROWS = 17;

/**
 * PNG do bonequinho para o Slack (que não aceita SVG no ícone). Quadrado, com o sprite centrado e
 * ampliado sem suavizar, sobre um fundo liso. Sem dependência: PNG RGBA com um único bloco IDAT.
 * `view: "bust"` corta na altura dos ombros, encostado na borda de baixo.
 */
export function spritePng(sprite: SpritePixels, opts: { scale?: number; background?: string; view?: "full" | "bust" } = {}): Buffer {
  const scale = opts.scale ?? 16;
  const bust = opts.view === "bust";
  // O busto começa na primeira linha desenhada: penteado baixo não deixa faixa vazia em cima.
  const first = sprite.pixels.findIndex((c) => c !== null);
  const top = bust && first > 0 ? Math.floor(first / sprite.width) : 0;
  const end = bust ? Math.min(BUST_ROWS, sprite.height) : sprite.height;
  const rows = end - top;
  const side = Math.max(sprite.width, rows) + (bust ? 3 : 8);
  const ox = Math.floor((side - sprite.width) / 2);
  const oy = side - rows - (bust ? 0 : 2) - top;
  const bg = hex(opts.background ?? "#10141c");
  const size = side * scale;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    const row = py * (size * 4 + 1);
    raw[row] = 0; // sem filtro
    const y = Math.floor(py / scale) - oy;
    for (let px = 0; px < size; px++) {
      const x = Math.floor(px / scale) - ox;
      const c = x >= 0 && y >= top && x < sprite.width && y < end ? sprite.pixels[y * sprite.width + x] : null;
      const [r, g, b] = c ? hex(c) : bg;
      const i = row + 1 + px * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function hex(c: string): [number, number, number] {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
