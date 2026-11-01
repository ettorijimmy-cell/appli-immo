import { describe, expect, it } from "vitest";
import { construireMailRemiseEtatDesLieux, type DonneesMailRemise } from "./mail-remise-etat-des-lieux";

const SORTIE: DonneesMailRemise = {
  phase: "sortie",
  adresseLogement: "12 rue Turgot",
  codePostalLogement: "75009",
  villeLogement: "Paris",
  dateSignature: "2026-11-03",
  lieuSignature: "Paris",
  nomBailleur: "SCI Turgot"
};

describe("construireMailRemiseEtatDesLieux", () => {
  it("sortie : objet et corps exacts", () => {
    expect(construireMailRemiseEtatDesLieux(SORTIE)).toEqual({
      objet: "État des lieux de sortie — 12 rue Turgot, 75009 Paris",
      corps:
        "Bonjour,\n\n" +
        "Vous trouverez ci-joint l'état des lieux de sortie du logement situé 12 rue Turgot, 75009 Paris, signé le 3 novembre 2026 à Paris.\n\n" +
        "Cordialement,\nSCI Turgot"
    });
  });

  it("entrée : libellé d'entrée dans l'objet et le corps", () => {
    const mail = construireMailRemiseEtatDesLieux({ ...SORTIE, phase: "entree" });

    expect(mail.objet).toBe("État des lieux d'entrée — 12 rue Turgot, 75009 Paris");
    expect(mail.corps).toContain("l'état des lieux d'entrée du logement");
    expect(mail.corps).not.toContain("sortie");
  });

  it("reprend le lieu de signature, qui peut différer de la ville du logement", () => {
    const mail = construireMailRemiseEtatDesLieux({ ...SORTIE, lieuSignature: "Lyon" });

    expect(mail.corps).toContain("signé le 3 novembre 2026 à Lyon.");
  });

  it("premier du mois : 1er", () => {
    const mail = construireMailRemiseEtatDesLieux({ ...SORTIE, dateSignature: "2026-08-01" });

    expect(mail.corps).toContain("signé le 1er août 2026");
  });

  it.each([
    ["2026-01-15", "15 janvier 2026"],
    ["2026-02-02", "2 février 2026"],
    ["2026-12-31", "31 décembre 2026"]
  ])("%s → %s, sans zéro devant le jour", (dateSignature, attendu) => {
    expect(construireMailRemiseEtatDesLieux({ ...SORTIE, dateSignature }).corps).toContain(`signé le ${attendu}`);
  });

  it.each(["", "2026-13-01", "03/11/2026", "2026-11"])("refuse une date inexploitable : %s", (dateSignature) => {
    expect(() => construireMailRemiseEtatDesLieux({ ...SORTIE, dateSignature })).toThrow("Date de signature invalide");
  });

  it("ne contient aucune affirmation juridique", () => {
    const { objet, corps } = construireMailRemiseEtatDesLieux(SORTIE);

    expect(`${objet} ${corps}`).not.toMatch(/décret|article|loi\b|valeur|obligation|délai|réserve|contest/i);
  });
});
