import { describe, expect, it } from "vitest";
import {
  LIBELLES_MODE_REMISE_BAIL,
  MODES_REMISE_BAIL,
  refusDateRemiseBail,
  remiseBailNonDeclareeASignaler
} from "./remise-bail";

describe("refusDateRemiseBail", () => {
  it("accepte une date passée et la date du jour", () => {
    expect(refusDateRemiseBail("2026-09-01", "2026-11-11")).toBeNull();
    expect(refusDateRemiseBail("2026-11-11", "2026-11-11")).toBeNull();
  });

  it("refuse une date dans le futur, même le lendemain", () => {
    expect(refusDateRemiseBail("2026-11-12", "2026-11-11")).toBe(
      "La date de remise du bail à la caution ne peut pas être dans le futur."
    );
  });

  it("refuse une date invalide ou mal formée", () => {
    for (const date of ["2026-02-30", "2026-13-01", "11/11/2026", "2026-1-1", ""]) {
      expect(refusDateRemiseBail(date, "2026-11-11")).toBe("La date de remise du bail à la caution est invalide.");
    }
  });
});

describe("MODES_REMISE_BAIL", () => {
  it("les quatre modes de l'enum, chacun avec son libellé", () => {
    expect(MODES_REMISE_BAIL).toEqual(["main_propre", "lettre_recommandee", "courrier_simple", "email"]);
    expect(MODES_REMISE_BAIL.map((mode) => LIBELLES_MODE_REMISE_BAIL[mode])).toEqual([
      "En main propre",
      "Lettre recommandée",
      "Courrier simple",
      "E-mail"
    ]);
  });
});

describe("remiseBailNonDeclareeASignaler", () => {
  const base = { statutBail: "actif", typeGarantie: "personne_physique", garantArchive: false, declarationActive: false };

  it("caution personne physique sans déclaration, bail signé : signalé", () => {
    for (const statutBail of ["actif", "preavis", "resilie"]) {
      expect(remiseBailNonDeclareeASignaler({ ...base, statutBail })).toBe(true);
    }
  });

  it("bail en brouillon : rien (la remise se fait à la signature)", () => {
    expect(remiseBailNonDeclareeASignaler({ ...base, statutBail: "brouillon" })).toBe(false);
  });

  it("déclaration active, garant Visale ou archivé : rien", () => {
    expect(remiseBailNonDeclareeASignaler({ ...base, declarationActive: true })).toBe(false);
    expect(remiseBailNonDeclareeASignaler({ ...base, typeGarantie: "garantie_visale" })).toBe(false);
    expect(remiseBailNonDeclareeASignaler({ ...base, garantArchive: true })).toBe(false);
  });
});
