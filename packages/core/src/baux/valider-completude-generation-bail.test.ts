import { describe, expect, it } from "vitest";
import { validerCompletudeGenerationBail, type DonneesCompletudeGenerationBail } from "./valider-completude-generation-bail";

const DONNEES_COMPLETES: DonneesCompletudeGenerationBail = {
  sci: { telephone: "0555555555", estFamiliale: true },
  immeuble: { anneeConstruction: 1998 },
  appartement: { equipementCuisine: "Plaques, four, réfrigérateur", dependancesAnnexes: "Aucune" },
  locataires: [{ adresse: "1 rue Test", codePostal: "75001", ville: "Paris" }],
  garants: [],
  irlIndisponible: false
};

describe("validerCompletudeGenerationBail", () => {
  it("ne renvoie aucun champ manquant quand tout est renseigné", () => {
    expect(validerCompletudeGenerationBail(DONNEES_COMPLETES)).toEqual([]);
  });

  it("signale le téléphone de la SCI manquant", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      sci: { ...DONNEES_COMPLETES.sci, telephone: null }
    });
    expect(manquants).toContain("Téléphone de la SCI");
  });

  it("signale est_familiale manquant, y compris false n'étant pas confondu avec absent", () => {
    const manquantsFalse = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      sci: { ...DONNEES_COMPLETES.sci, estFamiliale: false }
    });
    expect(manquantsFalse).toEqual([]);

    const manquantsNull = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      sci: { ...DONNEES_COMPLETES.sci, estFamiliale: null }
    });
    expect(manquantsNull).toContain("SCI familiale ou non (détermine la durée légale du bail)");
  });

  it("signale l'année de construction manquante", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      immeuble: { anneeConstruction: null }
    });
    expect(manquants).toContain("Année de construction de l'immeuble");
  });

  it("signale équipement cuisine et dépendances manquants séparément", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      appartement: { equipementCuisine: null, dependancesAnnexes: null }
    });
    expect(manquants).toContain("Équipement de la cuisine");
    expect(manquants).toContain("Dépendances et annexes de l'appartement");
  });

  it("numérote les locataires en cas de colocation, sans numéro pour un locataire seul", () => {
    const manquantsSeul = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      locataires: [{ adresse: null, codePostal: "75001", ville: "Paris" }]
    });
    expect(manquantsSeul).toContain("Locataire — adresse");

    const manquantsColoc = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      locataires: [
        { adresse: null, codePostal: "75001", ville: "Paris" },
        { adresse: "2 rue Test", codePostal: null, ville: "Paris" }
      ]
    });
    expect(manquantsColoc).toContain("Locataire 1 — adresse");
    expect(manquantsColoc).toContain("Locataire 2 — code postal");
  });

  it("signale l'IRL indisponible (absent ou périmé)", () => {
    const manquants = validerCompletudeGenerationBail({ ...DONNEES_COMPLETES, irlIndisponible: true });
    expect(manquants).toContain("Indice de référence des loyers (IRL) — aucune valeur récente disponible");
  });

  it("cumule tous les champs manquants dans un seul appel, pas un blocage au premier trouvé", () => {
    const manquants = validerCompletudeGenerationBail({
      sci: { telephone: null, estFamiliale: null },
      immeuble: { anneeConstruction: null },
      appartement: { equipementCuisine: null, dependancesAnnexes: null },
      locataires: [{ adresse: null, codePostal: null, ville: null }],
      garants: [],
      irlIndisponible: true
    });
    expect(manquants.length).toBe(9);
  });

  it("un bail sans garant ne signale jamais de champ garant manquant", () => {
    const manquants = validerCompletudeGenerationBail({ ...DONNEES_COMPLETES, garants: [] });
    expect(manquants.filter((m) => m.startsWith("Garant"))).toEqual([]);
  });

  it("signale les champs manquants d'un garant rattaché, numérote si plusieurs", () => {
    const manquantsUnSeul = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      garants: [{ dateNaissance: null, lieuNaissance: "Lyon", nationalite: "Française" }]
    });
    expect(manquantsUnSeul).toContain("Garant — date de naissance");

    const manquantsPlusieurs = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      garants: [
        { dateNaissance: null, lieuNaissance: "Lyon", nationalite: "Française" },
        { dateNaissance: "1980-01-01", lieuNaissance: null, nationalite: "Française" }
      ]
    });
    expect(manquantsPlusieurs).toContain("Garant 1 — date de naissance");
    expect(manquantsPlusieurs).toContain("Garant 2 — lieu de naissance");
  });
});
