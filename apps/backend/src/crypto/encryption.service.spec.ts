import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { EncryptionService } from "./encryption.service";

function buildService(): EncryptionService {
  const config = { get: () => undefined } as unknown as ConfigService;
  return new EncryptionService(config);
}

describe("EncryptionService", () => {
  it("chiffre puis déchiffre pour retrouver la valeur d'origine", () => {
    const service = buildService();
    const plaintext = "FR7630006000011234567890189";

    const ciphertext = service.encrypt(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(service.decrypt(ciphertext)).toBe(plaintext);
  });

  it("produit un chiffré différent à chaque appel (IV aléatoire)", () => {
    const service = buildService();
    const plaintext = "FR7630006000011234567890189";

    expect(service.encrypt(plaintext)).not.toBe(service.encrypt(plaintext));
  });

  it("échoue si le tag d'authentification est altéré", () => {
    const service = buildService();
    const ciphertext = service.encrypt("secret");
    const [iv, authTag, data] = ciphertext.split(":");
    const tampered = [iv, `${authTag!.slice(0, -2)}AA`, data].join(":");

    expect(() => service.decrypt(tampered)).toThrow();
  });
});
