import { describe, expect, it } from "vitest";
import { resoudreClassificationEmail } from "./resoudre-classification-email";

describe("resoudreClassificationEmail", () => {
  it("classe sur une correspondance contact unique", () => {
    const resultat = resoudreClassificationEmail([{ type: "contact", id: "contact-1" }]);
    expect(resultat).toEqual({ type: "contact", id: "contact-1" });
  });

  it("classe sur une correspondance locataire unique", () => {
    const resultat = resoudreClassificationEmail([{ type: "locataire", id: "locataire-1" }]);
    expect(resultat).toEqual({ type: "locataire", id: "locataire-1" });
  });

  it("classe sur une correspondance candidat unique", () => {
    const resultat = resoudreClassificationEmail([{ type: "candidat", id: "candidat-1" }]);
    expect(resultat).toEqual({ type: "candidat", id: "candidat-1" });
  });

  it("reste non_classe quand aucune correspondance", () => {
    expect(resoudreClassificationEmail([])).toEqual({ type: "non_classe", id: null });
  });

  it("reste non_classe quand deux entités distinctes partagent la même adresse — jamais de choix arbitraire", () => {
    const resultat = resoudreClassificationEmail([
      { type: "contact", id: "contact-1" },
      { type: "locataire", id: "locataire-1" }
    ]);
    expect(resultat).toEqual({ type: "non_classe", id: null });
  });

  it("reste non_classe même pour deux correspondances dans la même table (doublon de données)", () => {
    const resultat = resoudreClassificationEmail([
      { type: "locataire", id: "locataire-1" },
      { type: "locataire", id: "locataire-2" }
    ]);
    expect(resultat).toEqual({ type: "non_classe", id: null });
  });
});
