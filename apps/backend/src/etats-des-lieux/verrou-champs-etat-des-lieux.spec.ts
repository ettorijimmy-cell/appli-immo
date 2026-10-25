import { ConflictException } from "@nestjs/common";
import { etatDesLieuxCles, etatDesLieuxCompteurs, etatDesLieuxPieceEntree, etatsDesLieux } from "db";
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

  describe("fermé par défaut — champ ni structurel ni classé", () => {
    it("refuse (Error, pas ConflictException) même sans aucune phase signée — c'est un bug de configuration, pas une règle de gel", () => {
      expect(() =>
        verifierChampsAutorises(AUCUNE_PHASE_SIGNEE, etatDesLieuxPieceEntree, { champFantome: "x" }, null)
      ).toThrow(Error);
      expect(() =>
        verifierChampsAutorises(AUCUNE_PHASE_SIGNEE, etatDesLieuxPieceEntree, { champFantome: "x" }, null)
      ).not.toThrow(ConflictException);
    });

    it("nomme le champ fautif dans le message", () => {
      expect(() =>
        verifierChampsAutorises(AUCUNE_PHASE_SIGNEE, etatDesLieuxPieceEntree, { champFantome: "x" }, null)
      ).toThrow(/champFantome/);
    });

    it("collecte TOUS les champs non classés en un seul appel, pas seulement le premier", () => {
      expect(() =>
        verifierChampsAutorises(
          AUCUNE_PHASE_SIGNEE,
          etatDesLieuxPieceEntree,
          { champFantome1: "x", murDescription: "ok", champFantome2: "y" },
          null
        )
      ).toThrow(/champFantome1.*champFantome2|champFantome2.*champFantome1/);
    });

    it("un champ correctement classé ne déclenche jamais ce refus", () => {
      expect(() =>
        verifierChampsAutorises(AUCUNE_PHASE_SIGNEE, etatDesLieuxPieceEntree, { murDescription: "ok" }, null)
      ).not.toThrow();
    });
  });

  describe("comparaison normalisée (resoumission à l'identique)", () => {
    it("un décimal Postgres ('650.00', colonne `decimal`) et le même montant moins formaté ('650') reçu du DTO sont équivalents", () => {
      expect(() =>
        verifierChampsAutorises(
          ENTREE_SIGNEE,
          etatDesLieuxCompteurs,
          { electriciteReleveHpEntree: "650" },
          { electriciteReleveHpEntree: "650.00" }
        )
      ).not.toThrow();
    });

    it("un décimal réellement différent reste refusé", () => {
      expect(() =>
        verifierChampsAutorises(
          ENTREE_SIGNEE,
          etatDesLieuxCompteurs,
          { electriciteReleveHpEntree: "651" },
          { electriciteReleveHpEntree: "650.00" }
        )
      ).toThrow(ConflictException);
    });

    it("une date identique représentée par un objet Date d'un côté et une chaîne ISO de l'autre est équivalente", () => {
      expect(() =>
        verifierChampsAutorises(
          ENTREE_SIGNEE,
          etatsDesLieux,
          { dateEntree: "2026-01-15" },
          { dateEntree: new Date("2026-01-15T00:00:00.000Z") }
        )
      ).not.toThrow();
    });

    it("null (existant) et undefined-équivalent (absent) sont traités comme la même absence de valeur", () => {
      // valeur `null` explicite dans la ligne existante, valeur non-nulle
      // soumise : une vraie modification, toujours refusée.
      expect(() =>
        verifierChampsAutorises(ENTREE_SIGNEE, etatDesLieuxCles, { nombreEntree: 1 }, { nombreEntree: null })
      ).toThrow(ConflictException);
      // Les deux côtés `null` : aucune modification réelle.
      expect(() =>
        verifierChampsAutorises(ENTREE_SIGNEE, etatDesLieuxCles, { nombreEntree: null }, { nombreEntree: null })
      ).not.toThrow();
    });
  });
});
