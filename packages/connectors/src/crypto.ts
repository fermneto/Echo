import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Credenciais por empresa cifradas com AES-256-GCM.
 * Formato: "v1:<iv hex>:<tag hex>:<texto cifrado hex>". Trocar a ENCRYPTION_KEY invalida o que foi guardado.
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (!/^[0-9a-f]{64}$/i.test(hexKey)) throw new Error("ENCRYPTION_KEY precisa ter 64 caracteres hex (openssl rand -hex 32)");
    this.key = Buffer.from(hexKey, "hex");
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), data.toString("hex")].join(":");
  }

  decrypt(sealed: string): string {
    const [v, iv, tag, data] = sealed.split(":");
    if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("credencial cifrada em formato desconhecido");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
  }
}
