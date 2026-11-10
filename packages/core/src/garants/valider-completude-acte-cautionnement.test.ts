import { describe, expect, it } from "vitest";
import {
  validerCompletudeActeCautionnement,
  type DonneesCompletudeActeCautionnement
} from "./valider-completude-acte-cautionnement";

const COMPLET: DonneesCompletudeActeCautionnement = {
  garantId: "G1",
  caution: {
    typeGarantie: "personne_physique",
    nom: "Durand",
    prenom: "Claire",
    dateNaissance: "1965-03-20",
    lieuNaissance: "Lyon",
    nationalite: "Française",
    adresse: "8 rue de la Caution",
    codePostal: "69002",
    ville: "Lyon"
  },
  identitesLocataires: [{ id: "L1", nom: "Bernard", prenom: "Lucie" }],
  bail: {
    loyerMensuel: "650.00",
    provisionsCharges: null,
    dateDebut: "2026-12-01",
    choixDuree: { typeBail: "vide", regime: "personne_physique" },
    trimestreReferenceRevision: 2,
    irlIndisponible: false
  },
  bailleur: { nom: "Jean Exemple" },
  garanties: {
    assuranceLoyersImpayes: false,
    bailleur: { type: "personne_physique" },
    locataires: [{ id: "L1", statutEtudes: "aucun" }],
    garants: [{ id: "G1", typeGarantie: "personne_physique", locataireId: null, numeroContratVisale: null }]
  }
};

describe("validerCompletudeActeCautionnement", () => {
  it("dossier complet (provisions de charges nulles comprises) : rien ne manque", () => {
    expect(validerCompletudeActeCautionnement(COMPLET)).toEqual([]);
  });

  it("réservé à une caution personne physique", () => {
    expect(
      validerCompletudeActeCautionnement({ ...COMPLET, caution: { ...COMPLET.caution, typeGarantie: "garantie_visale" } })
    ).toEqual(["Acte de cautionnement réservé à une caution personne physique"]);
  });

  it("liste complète des champs de la caution manquants (null ou blanc)", () => {
    const manquants = validerCompletudeActeCautionnement({
      ...COMPLET,
      caution: {
        typeGarantie: "personne_physique",
        nom: "Durand",
        prenom: " ",
        dateNaissance: null,
        lieuNaissance: null,
        nationalite: null,
        adresse: null,
        codePostal: null,
        ville: null
      }
    });
    expect(manquants).toEqual([
      "Caution — prénom",
      "Caution — date de naissance",
      "Caution — lieu de naissance",
      "Caution — nationalité",
      "Caution — adresse",
      "Caution — code postal",
      "Caution — ville"
    ]);
  });

  it("bail : loyer, date d'effet, durée, révision et bailleur", () => {
    const manquants = validerCompletudeActeCautionnement({
      ...COMPLET,
      bail: {
        loyerMensuel: null,
        provisionsCharges: null,
        dateDebut: null,
        choixDuree: null,
        trimestreReferenceRevision: null,
        irlIndisponible: true
      },
      bailleur: { nom: null }
    });
    expect(manquants).toEqual([
      "Loyer du bail",
      "Date d'effet du bail",
      "Durée du bail (SCI familiale ou non)",
      "Trimestre IRL de référence du bail",
      "Indice de référence des loyers (IRL) — aucune valeur récente disponible",
      "Bailleur — nom"
    ]);
  });

  it("locataire garanti : identité introuvable, ou aucun locataire au bail", () => {
    expect(validerCompletudeActeCautionnement({ ...COMPLET, identitesLocataires: [] })).toEqual([
      "Locataire garanti — nom et prénom"
    ]);
    expect(
      validerCompletudeActeCautionnement({ ...COMPLET, garanties: { ...COMPLET.garanties, locataires: [] } })
    ).toEqual(["Locataire garanti — aucun locataire au bail"]);
  });

  it("« Caution de » vers un locataire parti du bail : son identité suffit", () => {
    expect(
      validerCompletudeActeCautionnement({
        ...COMPLET,
        identitesLocataires: [...COMPLET.identitesLocataires, { id: "L9", nom: "Partie", prenom: "Nina" }],
        garanties: {
          ...COMPLET.garanties,
          garants: [{ id: "G1", typeGarantie: "personne_physique", locataireId: "L9", numeroContratVisale: null }]
        }
      })
    ).toEqual([]);
  });

  it("intègre les règles d'acceptation de cette caution et les violations communes, pas celles des autres garants", () => {
    const manquants = validerCompletudeActeCautionnement({
      ...COMPLET,
      identitesLocataires: [
        { id: "L1", nom: "Bernard", prenom: "Lucie" },
        { id: "L2", nom: "Petit", prenom: "Hugo" }
      ],
      garanties: {
        assuranceLoyersImpayes: true,
        bailleur: { type: "sci", estFamiliale: null },
        locataires: [
          { id: "L1", statutEtudes: "aucun" },
          { id: "L2", statutEtudes: "aucun" }
        ],
        garants: [
          { id: "G1", typeGarantie: "personne_physique", locataireId: "L1", numeroContratVisale: null },
          { id: "G2", typeGarantie: "personne_physique", locataireId: null, numeroContratVisale: null }
        ]
      }
    });
    expect(manquants).toHaveLength(2);
    expect(manquants[0]).toMatch(/^Garant 1 — caution personne physique impossible : le bail est couvert/);
    expect(manquants[1]).toBe("SCI familiale ou non : à renseigner pour vérifier la caution personne physique");
  });
});
