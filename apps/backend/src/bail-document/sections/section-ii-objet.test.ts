import { describe, expect, it } from "vitest";
import { construireSectionII } from "./section-ii-objet";

const LOGEMENT_COMPLET = {
  adresseImmeuble: "5 avenue des Fleurs",
  codePostalImmeuble: "69001",
  villeImmeuble: "Lyon",
  numeroLot: "T3 2e étage",
  identifiantFiscal: "123456789",
  typeHabitat: "collectif" as const,
  regimeJuridique: "copropriete" as const,
  trancheConstruction: "de_1975_a_1989" as const,
  surface: "62.50",
  nombrePiecesPrincipales: 3,
  modeChauffage: "individuel" as const,
  modeEauChaude: "collectif" as const,
  classeDpe: "D" as const,
  depensesTheoriquesChauffage: "450.00"
};

describe("construireSectionII", () => {
  it("reprend tous les champs renseignés du logement", () => {
    const contenu = JSON.stringify(
      construireSectionII({
        typeBail: "vide",
        logement: LOGEMENT_COMPLET,
        dateReference: "2026-07-01",
        servitudeResidencePrincipale: false
      })
    );

    expect(contenu).toContain("5 avenue des Fleurs");
    expect(contenu).toContain("69001");
    expect(contenu).toContain("Lyon");
    expect(contenu).toContain("T3 2e étage");
    expect(contenu).toContain("123456789");
    expect(contenu).toContain("immeuble collectif");
    expect(contenu).toContain("copropriété");
    expect(contenu).toContain("de 1975 à 1989");
    expect(contenu).toContain("62.50");
    expect(contenu).toContain("individuelle");
    expect(contenu).toContain("collective");
    expect(contenu).toContain("D");
  });

  it("affiche [à renseigner] pour chaque champ manquant, sans planter", () => {
    const contenu = JSON.stringify(
      construireSectionII({
        typeBail: "vide",
        dateReference: "2026-07-01",
        servitudeResidencePrincipale: false,
        logement: {
          adresseImmeuble: "1 rue Test",
          codePostalImmeuble: null,
          villeImmeuble: null,
          numeroLot: "1",
          identifiantFiscal: null,
          typeHabitat: null,
          regimeJuridique: null,
          trancheConstruction: null,
          surface: null,
          nombrePiecesPrincipales: null,
          modeChauffage: null,
          modeEauChaude: null,
          classeDpe: null,
          depensesTheoriquesChauffage: null
        }
      })
    );

    expect(contenu.match(/à renseigner/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it("n'affiche jamais la mention servitude de résidence principale avant le 1er octobre 2026, même si applicable", () => {
    const contenu = JSON.stringify(
      construireSectionII({
        typeBail: "vide",
        logement: LOGEMENT_COMPLET,
        dateReference: "2026-09-30",
        servitudeResidencePrincipale: true
      })
    );
    expect(contenu).not.toContain("Servitude");
  });

  it("affiche la mention servitude de résidence principale à partir du 1er octobre 2026, uniquement si applicable", () => {
    const avecServitude = JSON.stringify(
      construireSectionII({
        typeBail: "vide",
        logement: LOGEMENT_COMPLET,
        dateReference: "2026-10-01",
        servitudeResidencePrincipale: true
      })
    );
    expect(avecServitude).toContain("Servitude de résidence principale");
    expect(avecServitude).toContain("L. 151-14-1");

    const sansServitude = JSON.stringify(
      construireSectionII({
        typeBail: "vide",
        logement: LOGEMENT_COMPLET,
        dateReference: "2026-10-01",
        servitudeResidencePrincipale: false
      })
    );
    expect(sansServitude).not.toContain("Servitude");
  });
});
