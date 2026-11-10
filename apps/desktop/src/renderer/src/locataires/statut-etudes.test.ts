import { describe, expect, it } from "vitest";
import { LIBELLES_STATUT_ETUDES, STATUTS_ETUDES } from "./statut-etudes";

describe("statut d'études du locataire", () => {
  it("menu : Non renseigné d'abord, puis les quatre statuts, avec leurs libellés", () => {
    expect(STATUTS_ETUDES.map((s) => LIBELLES_STATUT_ETUDES[s])).toEqual([
      "Non renseigné",
      "Ni étudiant ni apprenti",
      "Étudiant boursier",
      "Étudiant non boursier",
      "Apprenti"
    ]);
  });
});
