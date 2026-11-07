import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/authenticated-fetch";
import { confirmationArchivageRequise, messageErreurArchivage } from "./archivage-document";

describe("confirmationArchivageRequise", () => {
  it("une photo demande une confirmation", () => {
    expect(confirmationArchivageRequise({ categorie: "photo" })).toBe(true);
  });

  it("les autres documents s'archivent comme avant, sans confirmation", () => {
    expect(confirmationArchivageRequise({ categorie: "assurance" })).toBe(false);
    expect(confirmationArchivageRequise({ categorie: "etat_des_lieux" })).toBe(false);
  });
});

describe("messageErreurArchivage", () => {
  it("affiche le refus du backend tel quel (verrou de signature)", () => {
    const refus = new ApiError(
      409,
      "La partie entrée de cet état des lieux est signée : ses photos ne peuvent plus être archivées."
    );
    expect(messageErreurArchivage(refus, { categorie: "photo" })).toBe(
      "La partie entrée de cet état des lieux est signée : ses photos ne peuvent plus être archivées."
    );
  });

  it("erreur réseau : repli propre à une photo", () => {
    expect(messageErreurArchivage(new TypeError("fetch failed"), { categorie: "photo" })).toBe(
      "Impossible d'archiver cette photo."
    );
  });

  it("message générique NestJS : repli propre à un document", () => {
    expect(messageErreurArchivage(new ApiError(500, "Internal server error"), { categorie: "assurance" })).toBe(
      "Impossible d'archiver ce document."
    );
  });
});
