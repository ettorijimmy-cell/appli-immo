import { describe, expect, it } from "vitest";
import { validerCompletudeGenerationBail, type DonneesCompletudeGenerationBail } from "./valider-completude-generation-bail";

const DONNEES_COMPLETES: DonneesCompletudeGenerationBail = {
  bienType: "immeuble",
  sci: {
    telephone: "0555555555",
    estFamiliale: true,
    adresse: "10 rue du Siège",
    codePostal: "75002",
    ville: "Paris"
  },
  immeuble: { anneeConstruction: 1998, typeHabitat: "collectif", regimeJuridique: "copropriete" },
  appartement: {
    equipementCuisine: "Plaques, four, réfrigérateur",
    dependancesAnnexes: "Aucune",
    nombrePiecesPrincipales: 3,
    modeChauffage: "individuel",
    modeEauChaude: "individuel"
  },
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
      sci: { ...DONNEES_COMPLETES.sci!, telephone: null }
    });
    expect(manquants).toContain("Téléphone de la SCI");
  });

  it("signale est_familiale manquant, y compris false n'étant pas confondu avec absent", () => {
    const manquantsFalse = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      sci: { ...DONNEES_COMPLETES.sci!, estFamiliale: false }
    });
    expect(manquantsFalse).toEqual([]);

    const manquantsNull = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      sci: { ...DONNEES_COMPLETES.sci!, estFamiliale: null }
    });
    expect(manquantsNull).toContain("SCI familiale ou non (détermine la durée légale du bail)");
  });

  it("signale l'adresse, le code postal et la ville du siège social de la SCI manquants séparément", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      sci: { ...DONNEES_COMPLETES.sci!, adresse: null, codePostal: null, ville: null }
    });
    expect(manquants).toContain("Adresse du siège social de la SCI");
    expect(manquants).toContain("Code postal du siège social de la SCI");
    expect(manquants).toContain("Ville du siège social de la SCI");
  });

  it("bailleur en nom propre (sci: null) : aucun champ sci.* exigé", () => {
    const manquants = validerCompletudeGenerationBail({ ...DONNEES_COMPLETES, sci: null });
    expect(manquants).toEqual([]);
  });

  it("signale l'année de construction manquante", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      immeuble: { ...DONNEES_COMPLETES.immeuble, anneeConstruction: null }
    });
    expect(manquants).toContain("Année de construction de l'immeuble");
  });

  it("signale le type d'habitat et le régime juridique de l'immeuble manquants séparément", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      immeuble: { ...DONNEES_COMPLETES.immeuble, typeHabitat: null, regimeJuridique: null }
    });
    expect(manquants).toContain("Type d'habitat de l'immeuble (collectif/individuel)");
    expect(manquants).toContain("Régime juridique de l'immeuble (mono-propriété/copropriété)");
  });

  it("signale équipement cuisine et dépendances manquants séparément", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      appartement: { ...DONNEES_COMPLETES.appartement, equipementCuisine: null, dependancesAnnexes: null }
    });
    expect(manquants).toContain("Équipement de la cuisine");
    expect(manquants).toContain("Dépendances et annexes de l'appartement");
  });

  it("signale le nombre de pièces, le chauffage et l'eau chaude de l'appartement manquants séparément", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      appartement: {
        ...DONNEES_COMPLETES.appartement,
        nombrePiecesPrincipales: null,
        modeChauffage: null,
        modeEauChaude: null
      }
    });
    expect(manquants).toContain("Nombre de pièces principales de l'appartement");
    expect(manquants).toContain("Mode de chauffage de l'appartement (individuel/collectif)");
    expect(manquants).toContain("Mode de production d'eau chaude de l'appartement (individuelle/collective)");
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
      bienType: "immeuble",
      sci: { telephone: null, estFamiliale: null, adresse: null, codePostal: null, ville: null },
      immeuble: { anneeConstruction: null, typeHabitat: null, regimeJuridique: null },
      appartement: {
        equipementCuisine: null,
        dependancesAnnexes: null,
        nombrePiecesPrincipales: null,
        modeChauffage: null,
        modeEauChaude: null
      },
      locataires: [{ adresse: null, codePostal: null, ville: null }],
      garants: [],
      irlIndisponible: true
    });
    expect(manquants.length).toBe(17);
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

  it.each(["parking", "bureau", "local_commercial"] as const)(
    "bloque avec un message dédié pour un bien non résidentiel (%s), sans exiger les champs d'habitation",
    (bienType) => {
      const manquants = validerCompletudeGenerationBail({
        ...DONNEES_COMPLETES,
        bienType,
        appartement: {
          equipementCuisine: null,
          dependancesAnnexes: null,
          nombrePiecesPrincipales: null,
          modeChauffage: null,
          modeEauChaude: null
        }
      });
      expect(manquants).toEqual(["Génération de bail non disponible pour ce type de bien"]);
    }
  );
});

// Chantier garants (2026-11-08) : champs exigés selon le type de garant, et
// règles d'acceptation (verifierGarantiesBail) intégrées au contrôle.
describe("validerCompletudeGenerationBail — garants selon leur type", () => {
  const cautionIncomplete = { dateNaissance: null, lieuNaissance: null, nationalite: null };

  it("sans type (appel d'avant le commit 3) : caution personne physique, messages inchangés", () => {
    expect(validerCompletudeGenerationBail({ ...DONNEES_COMPLETES, garants: [cautionIncomplete] })).toEqual([
      "Garant — date de naissance",
      "Garant — lieu de naissance",
      "Garant — nationalité"
    ]);
  });

  it("Visale : naissance et nationalité jamais exigées, numéro de contrat exigé", () => {
    expect(
      validerCompletudeGenerationBail({
        ...DONNEES_COMPLETES,
        garants: [{ ...cautionIncomplete, typeGarantie: "garantie_visale", numeroContratVisale: "V0001" }]
      })
    ).toEqual([]);
    expect(
      validerCompletudeGenerationBail({
        ...DONNEES_COMPLETES,
        garants: [{ ...cautionIncomplete, typeGarantie: "garantie_visale", numeroContratVisale: null }]
      })
    ).toEqual(["Garant — numéro de contrat Visale"]);
  });

  it("intègre les règles d'acceptation, sans répéter le numéro Visale", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      locataires: [
        { adresse: "1 rue Test", codePostal: "75001", ville: "Paris" },
        { adresse: "2 rue Test", codePostal: "75001", ville: "Paris" }
      ],
      garants: [{ ...cautionIncomplete, typeGarantie: "garantie_visale", numeroContratVisale: null }],
      garanties: {
        assuranceLoyersImpayes: false,
        bailleur: { type: "sci", estFamiliale: true },
        locataires: [
          { id: "L1", statutEtudes: "aucun" },
          { id: "L2", statutEtudes: "aucun" }
        ],
        garants: [{ id: "V1", typeGarantie: "garantie_visale", locataireId: null, numeroContratVisale: null }]
      }
    });
    expect(manquants).toEqual([
      "Garant — numéro de contrat Visale",
      "Garant — garantie Visale impossible sur un bail à plusieurs locataires"
    ]);
  });

  it("SCI familiale non renseignée : un seul message (celui du bloc SCI)", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      sci: { ...DONNEES_COMPLETES.sci!, estFamiliale: null },
      garants: [{ dateNaissance: "1965-03-20", lieuNaissance: "Lyon", nationalite: "Française", typeGarantie: "personne_physique" }],
      garanties: {
        assuranceLoyersImpayes: false,
        bailleur: { type: "sci", estFamiliale: null },
        locataires: [{ id: "L1", statutEtudes: "aucun" }],
        garants: [{ id: "G1", typeGarantie: "personne_physique", locataireId: null, numeroContratVisale: null }]
      }
    });
    expect(manquants).toEqual(["SCI familiale ou non (détermine la durée légale du bail)"]);
  });

  it("caution bloquée par l'assurance loyers impayés : message de la règle", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      garants: [{ dateNaissance: "1965-03-20", lieuNaissance: "Lyon", nationalite: "Française", typeGarantie: "personne_physique" }],
      garanties: {
        assuranceLoyersImpayes: true,
        bailleur: { type: "sci", estFamiliale: true },
        locataires: [{ id: "L1", statutEtudes: "aucun" }],
        garants: [{ id: "G1", typeGarantie: "personne_physique", locataireId: null, numeroContratVisale: null }]
      }
    });
    expect(manquants).toHaveLength(1);
    expect(manquants[0]).toMatch(/^Garant — caution personne physique impossible : le bail est couvert par une assurance loyers impayés/);
  });

  it("type « autre » : aucun champ exigé, refus par la règle", () => {
    const manquants = validerCompletudeGenerationBail({
      ...DONNEES_COMPLETES,
      garants: [{ ...cautionIncomplete, typeGarantie: "autre" }],
      garanties: {
        assuranceLoyersImpayes: false,
        bailleur: { type: "personne_physique" },
        locataires: [{ id: "L1", statutEtudes: "aucun" }],
        garants: [{ id: "G1", typeGarantie: "autre", locataireId: null, numeroContratVisale: null }]
      }
    });
    expect(manquants).toEqual([
      "Garant — type « autre » non accepté : choisir caution personne physique ou garantie Visale"
    ]);
  });
});
