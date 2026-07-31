import { describe, expect, it } from "vitest";
import { calculerDureeBail, regimesDureeApplicables } from "./calculer-duree-bail";

describe("calculerDureeBail", () => {
  it("SCI familiale (vide) : trois ans, réputée personne physique", () => {
    const resultat = calculerDureeBail({ typeBail: "vide", regime: "sci_familiale" });
    expect(resultat.duree).toBe("trois ans");
    expect(resultat.texteLegal).toContain("réputé personne physique");
    expect(resultat.texteLegal).toContain("article 10");
  });

  it("SCI non familiale (vide) : six ans, personne morale", () => {
    const resultat = calculerDureeBail({ typeBail: "vide", regime: "sci_non_familiale" });
    expect(resultat.duree).toBe("six ans");
    expect(resultat.texteLegal).toContain("personne morale");
    expect(resultat.texteLegal).toContain("article 10");
  });

  it("meublé standard : un an", () => {
    const resultat = calculerDureeBail({ typeBail: "meuble", regime: "standard" });
    expect(resultat.duree).toBe("un an");
    expect(resultat.texteLegal).toContain("article 25-7");
  });

  it("meublé étudiant : neuf mois, sans reconduction tacite", () => {
    const resultat = calculerDureeBail({ typeBail: "meuble", regime: "etudiant" });
    expect(resultat.duree).toBe("neuf mois");
    expect(resultat.texteLegal).toContain("étudiant");
    expect(resultat.texteLegal).toContain("sans reconduction tacite");
  });
});

describe("regimesDureeApplicables", () => {
  it("vide : jamais de défaut, choix toujours requis (aucun immeuble sans SCI dans le schéma actuel)", () => {
    const resultat = regimesDureeApplicables("vide");
    expect(resultat.regimes).toEqual(["sci_familiale", "sci_non_familiale"]);
    expect(resultat.parDefaut).toBeNull();
  });

  it("meublé : un défaut existe (standard), reste confirmable", () => {
    const resultat = regimesDureeApplicables("meuble");
    expect(resultat.regimes).toEqual(["standard", "etudiant"]);
    expect(resultat.parDefaut).toBe("standard");
  });
});
