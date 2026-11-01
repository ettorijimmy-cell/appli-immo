import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { EnvoyerEtatDesLieuxDto } from "./envoyer-etat-des-lieux.dto";

const DEMANDE = "018f1e3a-0000-7000-8000-000000000001";
const LOCATAIRE = "018f1e3a-0000-7000-8000-000000000002";
const AUTRE = "018f1e3a-0000-7000-8000-000000000003";

async function proprietesEnErreur(corps: unknown): Promise<string[]> {
  const erreurs = await validate(plainToInstance(EnvoyerEtatDesLieuxDto, corps as object));
  return erreurs.map((e) => e.property);
}

describe("EnvoyerEtatDesLieuxDto", () => {
  it("accepte une demande avec un ou plusieurs destinataires", async () => {
    expect(
      await proprietesEnErreur({
        demandeId: DEMANDE,
        destinataires: [
          { locataireId: LOCATAIRE, email: "a@example.com" },
          { locataireId: AUTRE, email: "b@example.com" }
        ]
      })
    ).toEqual([]);
  });

  it("refuse une demande sans identifiant valide", async () => {
    expect(
      await proprietesEnErreur({ demandeId: "abc", destinataires: [{ locataireId: LOCATAIRE, email: "a@example.com" }] })
    ).toEqual(["demandeId"]);
  });

  it("refuse une liste vide ou absente", async () => {
    expect(await proprietesEnErreur({ demandeId: DEMANDE, destinataires: [] })).toEqual(["destinataires"]);
    expect(await proprietesEnErreur({ demandeId: DEMANDE })).toEqual(["destinataires"]);
  });

  it("refuse deux fois le même locataire", async () => {
    const destinataire = { locataireId: LOCATAIRE, email: "a@example.com" };

    expect(await proprietesEnErreur({ demandeId: DEMANDE, destinataires: [destinataire, destinataire] })).toEqual([
      "destinataires"
    ]);
  });

  it("refuse un destinataire mal formé", async () => {
    expect(
      await proprietesEnErreur({ demandeId: DEMANDE, destinataires: [{ locataireId: "abc", email: "a@example.com" }] })
    ).toEqual(["destinataires"]);
    expect(await proprietesEnErreur({ demandeId: DEMANDE, destinataires: [{ locataireId: LOCATAIRE }] })).toEqual([
      "destinataires"
    ]);
  });
});
