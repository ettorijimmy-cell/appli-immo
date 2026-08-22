import { describe, expect, it } from "vitest";
import { estViolationIndexBauxActifUnique } from "./baux.service";

// Gap 1 — concurrence Module 3 (docs/backlog.md, dette technique) : cette
// fonction traduit une violation de l'index unique partiel
// baux_appartement_id_actif_unique en ConflictException propre plutôt que
// de laisser remonter l'erreur SQL brute. Voir baux.service.ts, activer().
describe("estViolationIndexBauxActifUnique", () => {
  it("reconnaît une vraie violation de l'index (code + nom de contrainte corrects)", () => {
    const erreur = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      constraint_name: "baux_appartement_id_actif_unique"
    });
    expect(estViolationIndexBauxActifUnique(erreur)).toBe(true);
  });

  it("rejette un code 23505 sur une contrainte différente — ne doit jamais absorber une autre violation unique", () => {
    const erreur = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      constraint_name: "une_autre_contrainte_unique"
    });
    expect(estViolationIndexBauxActifUnique(erreur)).toBe(false);
  });

  it("rejette un code d'erreur Postgres différent de 23505", () => {
    const erreur = Object.assign(new Error("foreign key violation"), {
      code: "23503",
      constraint_name: "baux_appartement_id_actif_unique"
    });
    expect(estViolationIndexBauxActifUnique(erreur)).toBe(false);
  });

  it("rejette une valeur qui n'est pas une Error", () => {
    expect(estViolationIndexBauxActifUnique("erreur générique")).toBe(false);
    expect(estViolationIndexBauxActifUnique(null)).toBe(false);
    expect(estViolationIndexBauxActifUnique(undefined)).toBe(false);
  });
});
