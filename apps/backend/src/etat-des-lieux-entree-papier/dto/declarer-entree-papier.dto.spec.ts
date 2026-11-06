import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { DeclarerEntreePapierDto } from "./declarer-entree-papier.dto";

const ID_A = "0190f5a2-0000-7000-8000-000000000001";
const ID_B = "0190f5a2-0000-7000-8000-000000000002";

// Champs multipart : tout arrive en chaîne, locataireIds en chaîne seule,
// en champ répété (tableau) ou en tableau JSON.
async function valider(corps: Record<string, unknown>) {
  const dto = plainToInstance(DeclarerEntreePapierDto, {
    dateSignature: "2026-08-01",
    lieu: "Lyon",
    bailleurNom: "SCI",
    ...corps
  });
  return { dto, erreurs: await validate(dto, { whitelist: true }) };
}

describe("DeclarerEntreePapierDto", () => {
  it("un seul locataire envoyé en chaîne devient un tableau", async () => {
    const { dto, erreurs } = await valider({ locataireIds: ID_A });
    expect(erreurs).toEqual([]);
    expect(dto.locataireIds).toEqual([ID_A]);
  });

  it("champ répété (tableau) ou tableau JSON", async () => {
    expect((await valider({ locataireIds: [ID_A, ID_B] })).dto.locataireIds).toEqual([ID_A, ID_B]);
    const json = await valider({ locataireIds: JSON.stringify([ID_A, ID_B]) });
    expect(json.erreurs).toEqual([]);
    expect(json.dto.locataireIds).toEqual([ID_A, ID_B]);
  });

  it("refuse un tableau vide, un identifiant invalide ou des champs texte manquants", async () => {
    expect((await valider({ locataireIds: [] })).erreurs).not.toEqual([]);
    expect((await valider({ locataireIds: "pas-un-uuid" })).erreurs).not.toEqual([]);
    expect((await valider({ locataireIds: ID_A, lieu: "" })).erreurs).not.toEqual([]);
    expect((await valider({ locataireIds: ID_A, bailleurNom: undefined })).erreurs).not.toEqual([]);
  });
});
