import { describe, expect, it } from "vitest";
import { calculerActionAlerte } from "./calculer-action-alerte";

describe("calculerActionAlerte", () => {
  describe("aucune alerte existante", () => {
    it("crée si la condition est vraie", () => {
      expect(calculerActionAlerte(null, false, true)).toEqual({ action: "creer" });
    });
    it("ne fait rien si la condition est fausse", () => {
      expect(calculerActionAlerte(null, false, false)).toEqual({ action: "aucune" });
    });
  });

  describe("statut active", () => {
    it("ne fait rien si la condition reste vraie", () => {
      expect(calculerActionAlerte("active", true, true)).toEqual({ action: "aucune" });
    });
    it("ferme si la condition devient fausse", () => {
      expect(calculerActionAlerte("active", true, false)).toEqual({ action: "fermer" });
    });
    it("met à jour le suivi si la condition redevient vraie sans être passée par fermer d'abord", () => {
      expect(calculerActionAlerte("active", false, true)).toEqual({ action: "maj_condition", conditionVraie: true });
    });
    it("ne fait rien si la condition reste fausse (cas normalement transitoire)", () => {
      expect(calculerActionAlerte("active", false, false)).toEqual({ action: "aucune" });
    });
  });

  describe("statut resolue", () => {
    it("se rouvre si la condition redevient vraie", () => {
      expect(calculerActionAlerte("resolue", false, true)).toEqual({ action: "rouvrir" });
    });
    it("ne fait rien si la condition reste fausse", () => {
      expect(calculerActionAlerte("resolue", false, false)).toEqual({ action: "aucune" });
    });
    it("réaligne le suivi si la condition est encore vraie (cas normalement inatteignable, défensif)", () => {
      expect(calculerActionAlerte("resolue", true, false)).toEqual({
        action: "maj_condition",
        conditionVraie: false
      });
    });
  });

  describe("statut traitee (décision humaine, jamais réécrite)", () => {
    it("ne crée rien si la condition est restée vraie sans interruption", () => {
      expect(calculerActionAlerte("traitee", true, true)).toEqual({ action: "aucune" });
    });
    it("crée une nouvelle occurrence si la condition est passée par faux puis revenue vraie", () => {
      expect(calculerActionAlerte("traitee", false, true)).toEqual({ action: "creer" });
    });
    it("met à jour le suivi (sans toucher au statut) quand la condition devient fausse", () => {
      expect(calculerActionAlerte("traitee", true, false)).toEqual({
        action: "maj_condition",
        conditionVraie: false
      });
    });
    it("ne fait rien si la condition reste fausse", () => {
      expect(calculerActionAlerte("traitee", false, false)).toEqual({ action: "aucune" });
    });
  });

  describe("statut ignoree (même comportement que traitee)", () => {
    it("ne crée rien si la condition est restée vraie sans interruption", () => {
      expect(calculerActionAlerte("ignoree", true, true)).toEqual({ action: "aucune" });
    });
    it("crée une nouvelle occurrence si la condition est passée par faux puis revenue vraie", () => {
      expect(calculerActionAlerte("ignoree", false, true)).toEqual({ action: "creer" });
    });
  });

  it("scénario impaye motivant la refonte : impaye -> payé -> impaye à nouveau", () => {
    // Échéance impayée : création.
    expect(calculerActionAlerte(null, false, true)).toEqual({ action: "creer" });
    // Le paiement est réglé (enregistrer()) : le job observe condition=false, ferme.
    expect(calculerActionAlerte("active", true, false)).toEqual({ action: "fermer" });
    // annulerEnregistrement() repasse le paiement à impaye : la ligne resolue se rouvre EN PLACE.
    expect(calculerActionAlerte("resolue", false, true)).toEqual({ action: "rouvrir" });
  });
});
