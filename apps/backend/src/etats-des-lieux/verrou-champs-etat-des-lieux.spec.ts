import { ConflictException } from "@nestjs/common";
import { etatDesLieuxCles, etatDesLieuxPieceEntree } from "db";
import { describe, expect, it } from "vitest";
import { verifierChampsAutorises } from "./verrou-champs-etat-des-lieux";

const AUCUNE_PHASE_SIGNEE = { entreeSignee: false, sortieSignee: false };
const ENTREE_SIGNEE = { entreeSignee: true, sortieSignee: false };
const SORTIE_SIGNEE = { entreeSignee: true, sortieSignee: true };

describe("verifierChampsAutorises", () => {
  it("n'interdit rien tant qu'aucune phase n'est signée", () => {
    expect(() =>
      verifierChampsAutorises(
        AUCUNE_PHASE_SIGNEE,
        etatDesLieuxPieceEntree,
        { murDescription: "fissure", murEtatEntree: "M", murEtatSortie: "B" },
        null
      )
    ).not.toThrow();
  });

  it("entrée signée : un champ 'entree' est refusé", () => {
    expect(() =>
      verifierChampsAutorises(ENTREE_SIGNEE, etatDesLieuxPieceEntree, { murEtatEntree: "M" }, null)
    ).toThrow(ConflictException);
  });

  it("entrée signée : un champ 'commune' est refusé (figé dès l'entrée, pas seulement à la sortie)", () => {
    expect(() =>
      verifierChampsAutorises(ENTREE_SIGNEE, etatDesLieuxPieceEntree, { murDescription: "fissure" }, null)
    ).toThrow(ConflictException);
  });

  it("entrée signée : un champ 'sortie' reste autorisé", () => {
    expect(() =>
      verifierChampsAutorises(ENTREE_SIGNEE, etatDesLieuxPieceEntree, { murEtatSortie: "B" }, null)
    ).not.toThrow();
  });

  it("sortie signée : même un champ 'sortie' est désormais refusé", () => {
    expect(() =>
      verifierChampsAutorises(SORTIE_SIGNEE, etatDesLieuxPieceEntree, { murEtatSortie: "B" }, null)
    ).toThrow(ConflictException);
  });

  it("ignore les colonnes structurelles (jamais classées)", () => {
    expect(() =>
      verifierChampsAutorises(SORTIE_SIGNEE, etatDesLieuxPieceEntree, { id: "x", version: 2 }, null)
    ).not.toThrow();
  });

  it("ignore les champs `undefined` (non soumis)", () => {
    expect(() =>
      verifierChampsAutorises(ENTREE_SIGNEE, etatDesLieuxPieceEntree, { murEtatEntree: undefined }, null)
    ).not.toThrow();
  });

  it("resoumission à l'identique d'un champ gelé (même valeur que la ligne existante) : jamais bloquée", () => {
    expect(() =>
      verifierChampsAutorises(
        ENTREE_SIGNEE,
        etatDesLieuxCles,
        { typeCle: "cave", nombreSortie: 1 },
        { typeCle: "cave", nombreEntree: 1, nombreSortie: null }
      )
    ).not.toThrow();
  });

  it("une vraie modification d'un champ gelé reste refusée, même avec une ligne existante fournie", () => {
    expect(() =>
      verifierChampsAutorises(
        ENTREE_SIGNEE,
        etatDesLieuxCles,
        { typeCle: "boite_lettres" },
        { typeCle: "cave", nombreEntree: 1, nombreSortie: null }
      )
    ).toThrow(ConflictException);
  });

  it("lève une erreur de programmation si la table n'est pas enregistrée dans CLASSIFICATION_PAR_TABLE", () => {
    const tableInconnue = { _: { name: "table_inconnue" } } as unknown as typeof etatDesLieuxPieceEntree;
    expect(() => verifierChampsAutorises(ENTREE_SIGNEE, tableInconnue, { x: 1 }, null)).toThrow(
      /CLASSIFICATION_PAR_TABLE/
    );
  });
});
