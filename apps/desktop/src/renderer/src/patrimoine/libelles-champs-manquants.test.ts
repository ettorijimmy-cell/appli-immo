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

  it("traduit un garant sans numéro, en indiquant les deux écrans possibles", () => {
    const resultat = resoudreAffichageChampManquant("Garant — date de naissance");
    expect(resultat.libelle).toBe("Date de naissance du garant");
    expect(resultat.lieu).toBe("Section Garants (fiche du locataire ou onglet « Bail actuel »), bouton « Modifier »");
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

  // Chantier garants (2026-11-08) : messages de la génération et de
  // GET /baux/:id/verification-garanties.
  it("traduit le numéro de contrat Visale manquant comme un champ du garant", () => {
    expect(resoudreAffichageChampManquant("Garant — numéro de contrat Visale")).toEqual({
      libelle: "Numéro de contrat Visale du garant",
      lieu: "Section Garants (fiche du locataire ou onglet « Bail actuel »), bouton « Modifier »"
    });
  });

  it("traduit le contrat Visale manquant vers les documents du garant", () => {
    expect(resoudreAffichageChampManquant("Garant Visale — contrat de cautionnement Visale (PDF) à joindre")).toEqual({
      libelle: "Contrat de cautionnement Visale (PDF) à joindre",
      lieu: "Section Garants, bouton « Documents » du garant Visale"
    });
  });

  it("traduit une règle d'acceptation, avec le numéro du garant et l'écran selon la règle", () => {
    expect(
      resoudreAffichageChampManquant(
        "Garant 2 — caution personne physique impossible : le bail est couvert par une assurance loyers impayés (sauf locataire garanti étudiant ou apprenti)."
      )
    ).toEqual({
      libelle:
        "Caution personne physique impossible : le bail est couvert par une assurance loyers impayés (sauf locataire garanti étudiant ou apprenti). (garant 2)",
      lieu: "Onglet « Bail actuel », bouton « Modifier » (assurance loyers impayés), ou fiche du locataire (statut d'études)"
    });
    expect(
      resoudreAffichageChampManquant("Garant — caution personne physique impossible : le bailleur est une SCI non familiale (sauf locataire garanti étudiant non boursier).").lieu
    ).toBe("Fiche de la SCI (SCI familiale), ou fiche du locataire (statut d'études)");
    expect(resoudreAffichageChampManquant("Garant — la garantie Visale doit être le seul garant du bail")).toEqual({
      libelle: "La garantie Visale doit être le seul garant du bail",
      lieu: "Section Garants (fiche du locataire ou onglet « Bail actuel »), bouton « Modifier »"
    });
  });

  it("traduit la SCI familiale non renseignée vers la fiche de la SCI", () => {
    expect(
      resoudreAffichageChampManquant("SCI familiale ou non : à renseigner pour vérifier la caution personne physique").lieu
    ).toBe("Fiche de la SCI, bouton « Modifier »");
  });
});
