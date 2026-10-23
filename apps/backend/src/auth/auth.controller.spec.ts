import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { adresseIpReelle } from "./auth.controller";

function requete(headers: Record<string, string>, ip?: string): Request {
  return { headers, ip } as unknown as Request;
}

describe("adresseIpReelle", () => {
  it("utilise X-Real-IP quand présent (en-tête posé par l'edge Scaleway)", () => {
    expect(adresseIpReelle(requete({ "x-real-ip": "203.0.113.7" }, "10.0.0.1"))).toBe("203.0.113.7");
  });

  it("retombe sur request.ip quand X-Real-IP est absent (dev local, pas de proxy)", () => {
    expect(adresseIpReelle(requete({}, "127.0.0.1"))).toBe("127.0.0.1");
  });

  it("ignore un X-Real-IP vide et retombe sur request.ip", () => {
    expect(adresseIpReelle(requete({ "x-real-ip": "" }, "127.0.0.1"))).toBe("127.0.0.1");
  });

  it('renvoie "inconnue" si ni l\'en-tête ni request.ip ne sont disponibles', () => {
    expect(adresseIpReelle(requete({}, undefined))).toBe("inconnue");
  });
});
