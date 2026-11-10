import { describe, expect, it } from "vitest";
import { lignesAvertissementsGaranties } from "./avertissements-garanties";

describe("encadré des avertissements sur les garanties", () => {
  it("rien à afficher : pas encore chargé, ou aucune violation ni pièce manquante", () => {
    expect(lignesAvertissementsGaranties(null)).toEqual([]);
    expect(lignesAvertissementsGaranties({ violations: [], piecesManquantes: [] })).toEqual([]);
  });

  it("violations puis pièces manquantes, traduites comme les messages de génération", () => {
    expect(
      lignesAvertissementsGaranties({
        violations: [
          { code: "visale_numero_contrat_manquant", garantId: "g1", message: "Garant — numéro de contrat Visale" },
          {
            code: "sci_familiale_non_renseignee",
            garantId: null,
            message: "SCI familiale ou non : à renseigner pour vérifier la caution personne physique"
          }
        ],
        piecesManquantes: [
          {
            code: "contrat_visale_manquant",
            garantId: "g1",
            categorie: "contrat_cautionnement_visale",
            message: "Garant Visale — contrat de cautionnement Visale (PDF) à joindre"
          }
        ]
      })
    ).toEqual([
      {
        cle: "violation-0-visale_numero_contrat_manquant",
        libelle: "Numéro de contrat Visale du garant",
        lieu: "Section Garants (fiche du locataire ou onglet « Bail actuel »), bouton « Modifier »"
      },
      {
        cle: "violation-1-sci_familiale_non_renseignee",
        libelle: "SCI : SCI familiale à renseigner (nécessaire pour vérifier la caution)",
        lieu: "Fiche de la SCI, bouton « Modifier »"
      },
      {
        cle: "piece-g1-contrat_visale_manquant",
        libelle: "Contrat de cautionnement Visale (PDF) à joindre",
        lieu: "Section Garants, bouton « Documents » du garant Visale"
      }
    ]);
  });
});
