import { describe, expect, it } from "vitest";
import { resoudreAffichageChampManquant } from "./libelles-champs-manquants";

describe("resoudreAffichageChampManquant", () => {
  it("traduit un champ SCI fixe avec son lieu de saisie", () => {
    expect(resoudreAffichageChampManquant("Téléphone de la SCI")).toEqual({
      libelle: "Téléphone de la SCI",
      lieu: "Fiche de la SCI, bouton « Modifier »"
    });
  });

  it("reformule le champ SCI familiale selon le libellé validé", () => {
    expect(resoudreAffichageChampManquant("SCI familiale ou non (détermine la durée légale du bail)")).toEqual({
      libelle: "SCI : SCI familiale à renseigner",
      lieu: "Fiche de la SCI, bouton « Modifier »"
    });
  });

  it("traduit un champ de l'appartement vers la fiche de l'appartement", () => {
    expect(resoudreAffichageChampManquant("Équipement de la cuisine").lieu).toBe(
      "Fiche de l'appartement, bouton « Modifier »"
    );
  });

  it("traduit un locataire sans numéro (bail à un seul locataire)", () => {
    expect(resoudreAffichageChampManquant("Locataire — adresse")).toEqual({
      libelle: "Adresse du locataire",
      lieu: "Fiche du locataire, bouton « Modifier »"
    });
  });

  it("traduit un locataire numéroté (colocation)", () => {
    expect(resoudreAffichageChampManquant("Locataire 2 — ville").libelle).toBe("Ville du locataire 2");
  });

  it("traduit un garant sans numéro, avec l'avertissement sur le bon formulaire", () => {
    const resultat = resoudreAffichageChampManquant("Garant — date de naissance");
    expect(resultat.libelle).toBe("Date de naissance du garant");
    expect(resultat.lieu).toContain("section Garants");
    expect(resultat.lieu).toContain("Bail actuel");
  });

  it("traduit un garant numéroté (plusieurs garants)", () => {
    expect(resoudreAffichageChampManquant("Garant 1 — nationalité").libelle).toBe("Nationalité du garant 1");
  });

  it("indique qu'aucune action n'est possible pour l'IRL indisponible", () => {
    const resultat = resoudreAffichageChampManquant("Indice de référence des loyers (IRL) — aucune valeur récente disponible");
    expect(resultat.lieu).toContain("contactez l'administrateur");
  });

  it("retombe sur le texte brut sans lieu pour un libellé inconnu (backend modifié sans mise à jour de la correspondance)", () => {
    expect(resoudreAffichageChampManquant("Un nouveau champ jamais vu")).toEqual({
      libelle: "Un nouveau champ jamais vu",
      lieu: ""
    });
  });
});
