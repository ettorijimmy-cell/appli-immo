import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateGarantDto } from "./create-garant.dto";

// Chantier garants (2026-11-08) : types saisissables et champs exigés
// selon le type à la création.
describe("CreateGarantDto", () => {
  const base = { bailId: "019a0000-0000-7000-8000-000000000001" };

  async function proprietesEnErreur(valeurs: Record<string, unknown>): Promise<string[]> {
    const erreurs = await validate(plainToInstance(CreateGarantDto, { ...base, ...valeurs }));
    return erreurs.map((e) => e.property).sort();
  }

  it("caution personne physique : nom et prénom exigés", async () => {
    expect(await proprietesEnErreur({ typeGarantie: "personne_physique", nom: "Durand", prenom: "Claire" })).toEqual([]);
    expect(await proprietesEnErreur({ typeGarantie: "personne_physique" })).toEqual(["nom", "prenom"]);
    expect(await proprietesEnErreur({ typeGarantie: "personne_physique", nom: "Durand", prenom: "" })).toEqual([
      "prenom"
    ]);
  });

  it("garantie Visale : nom et prénom non exigés (imposés par le serveur), numéro de contrat accepté", async () => {
    expect(await proprietesEnErreur({ typeGarantie: "garantie_visale" })).toEqual([]);
    expect(await proprietesEnErreur({ typeGarantie: "garantie_visale", numeroContratVisale: "V0001" })).toEqual([]);
    expect(await proprietesEnErreur({ typeGarantie: "garantie_visale", numeroContratVisale: 12 })).toEqual([
      "numeroContratVisale"
    ]);
  });

  it("type « autre » refusé, avec un message clair", async () => {
    const erreurs = await validate(
      plainToInstance(CreateGarantDto, { ...base, typeGarantie: "autre", nom: "Durand", prenom: "Claire" })
    );
    const erreur = erreurs.find((e) => e.property === "typeGarantie");
    expect(Object.values(erreur?.constraints ?? {})).toContain(
      "typeGarantie doit être personne_physique (caution) ou garantie_visale : le type « autre » n'est plus accepté"
    );
  });

  it("type absent refusé", async () => {
    expect(await proprietesEnErreur({ nom: "Durand", prenom: "Claire" })).toEqual(["typeGarantie"]);
  });
});
