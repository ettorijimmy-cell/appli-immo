import { describe, expect, it } from "vitest";
import {
  phaseSigneeNumeriquement,
  phasesDepuisEtatDesLieux,
  photoEtatDesLieuxArchivable,
  resoudrePhasesEtatDesLieux,
  type EntreePapierEtatDesLieux
} from "./phases-etat-des-lieux";

const PAPIER: EntreePapierEtatDesLieux = {
  dateSignature: "2026-08-01",
  lieu: "Lyon",
  nomsSignataires: ["SCI Exemple", "Jean Dupont"]
};

describe("resoudrePhasesEtatDesLieux", () => {
  it("aucune signature, aucune entrée papier : rien n'est signé", () => {
    expect(resoudrePhasesEtatDesLieux({ phasesSigneesParBailleur: [], entreePapier: null })).toEqual({
      entreeSignee: false,
      entreePapier: null,
      sortieSignee: false
    });
  });

  it("entrée signée numériquement", () => {
    const phases = resoudrePhasesEtatDesLieux({ phasesSigneesParBailleur: ["entree"], entreePapier: null });
    expect(phases).toEqual({ entreeSignee: true, entreePapier: null, sortieSignee: false });
    expect(phaseSigneeNumeriquement(phases, "entree")).toBe(true);
    expect(phaseSigneeNumeriquement(phases, "sortie")).toBe(false);
  });

  it("entrée et sortie signées numériquement", () => {
    const phases = resoudrePhasesEtatDesLieux({ phasesSigneesParBailleur: ["entree", "sortie"], entreePapier: null });
    expect(phases).toEqual({ entreeSignee: true, entreePapier: null, sortieSignee: true });
    expect(phaseSigneeNumeriquement(phases, "entree")).toBe(true);
    expect(phaseSigneeNumeriquement(phases, "sortie")).toBe(true);
  });

  it("doublons de phase (plusieurs lignes bailleur relues) : même résultat", () => {
    expect(
      resoudrePhasesEtatDesLieux({ phasesSigneesParBailleur: ["entree", "entree"], entreePapier: null })
    ).toEqual({ entreeSignee: true, entreePapier: null, sortieSignee: false });
  });

  it("entrée papier : verrou posé (A), aucun artefact numérique d'entrée (B)", () => {
    const phases = resoudrePhasesEtatDesLieux({ phasesSigneesParBailleur: [], entreePapier: PAPIER });
    expect(phases).toEqual({ entreeSignee: true, entreePapier: PAPIER, sortieSignee: false });
    expect(phaseSigneeNumeriquement(phases, "entree")).toBe(false);
  });

  it("entrée papier puis sortie signée numériquement : la sortie a ses artefacts", () => {
    const phases = resoudrePhasesEtatDesLieux({ phasesSigneesParBailleur: ["sortie"], entreePapier: PAPIER });
    expect(phases.entreeSignee).toBe(true);
    expect(phases.sortieSignee).toBe(true);
    expect(phaseSigneeNumeriquement(phases, "entree")).toBe(false);
    expect(phaseSigneeNumeriquement(phases, "sortie")).toBe(true);
  });
});

describe("photoEtatDesLieuxArchivable", () => {
  const rien = { entreeSignee: false, sortieSignee: false };
  const entreeAcquise = { entreeSignee: true, sortieSignee: false };
  const sortieSignee = { entreeSignee: true, sortieSignee: true };

  it("rien de signé : toute photo est archivable", () => {
    expect(photoEtatDesLieuxArchivable(rien, "entree")).toBe(true);
    expect(photoEtatDesLieuxArchivable(rien, "sortie")).toBe(true);
    expect(photoEtatDesLieuxArchivable(rien, null)).toBe(true);
  });

  it("entrée acquise (numérique ou papier) : photos d'entrée figées, photos de sortie archivables", () => {
    expect(photoEtatDesLieuxArchivable(entreeAcquise, "entree")).toBe(false);
    expect(photoEtatDesLieuxArchivable(entreeAcquise, "sortie")).toBe(true);
  });

  it("photo sans phase : traitée comme une photo d'entrée", () => {
    expect(photoEtatDesLieuxArchivable(entreeAcquise, null)).toBe(false);
  });

  it("entrée papier : même verrou que la signature numérique", () => {
    const phases = resoudrePhasesEtatDesLieux({ phasesSigneesParBailleur: [], entreePapier: PAPIER });
    expect(photoEtatDesLieuxArchivable(phases, "entree")).toBe(false);
    expect(photoEtatDesLieuxArchivable(phases, "sortie")).toBe(true);
  });

  it("sortie signée : plus aucune photo archivable", () => {
    expect(photoEtatDesLieuxArchivable(sortieSignee, "entree")).toBe(false);
    expect(photoEtatDesLieuxArchivable(sortieSignee, "sortie")).toBe(false);
    expect(photoEtatDesLieuxArchivable(sortieSignee, null)).toBe(false);
  });
});

describe("phasesDepuisEtatDesLieux", () => {
  it("relit la forme de l'API", () => {
    expect(
      phasesDepuisEtatDesLieux({ entreeSigneeParTous: true, sortieSigneeParTous: false, entreePapier: PAPIER })
    ).toEqual({ entreeSignee: true, entreePapier: PAPIER, sortieSignee: false });
  });

  it("entreePapier absent (client plus ancien que le champ) : jamais pris pour une entrée papier", () => {
    const phases = phasesDepuisEtatDesLieux({ entreeSigneeParTous: true, sortieSigneeParTous: false });
    expect(phases.entreePapier).toBeNull();
    expect(phaseSigneeNumeriquement(phases, "entree")).toBe(true);
  });
});
