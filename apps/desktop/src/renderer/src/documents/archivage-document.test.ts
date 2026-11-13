import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/authenticated-fetch";
import { messageErreurApi } from "../lib/message-erreur-api";
import { messageRepliArchivage } from "./archivage-document";

describe("messageRepliArchivage", () => {
  it("repli propre à une photo ou à un autre document", () => {
    expect(messageRepliArchivage({ categorie: "photo" })).toBe("Impossible d'archiver cette photo.");
    expect(messageRepliArchivage({ categorie: "assurance" })).toBe("Impossible d'archiver ce document.");
  });
});

// Message affiché dans la modale d'archivage d'un document : celui de
// l'API quand il est exploitable, sinon le repli ci-dessus (même
// combinaison que lib/action-confirmee.ts).
describe("message d'erreur à l'archivage d'un document", () => {
  it("affiche le refus du backend tel quel (verrou de signature)", () => {
    const refus = new ApiError(
      409,
      "La partie entrée de cet état des lieux est signée : ses photos ne peuvent plus être archivées."
    );
    expect(messageErreurApi(refus, messageRepliArchivage({ categorie: "photo" }))).toBe(
      "La partie entrée de cet état des lieux est signée : ses photos ne peuvent plus être archivées."
    );
  });

  it("erreur réseau : repli propre à une photo", () => {
    expect(messageErreurApi(new TypeError("fetch failed"), messageRepliArchivage({ categorie: "photo" }))).toBe(
      "Impossible d'archiver cette photo."
    );
  });

  it("message générique NestJS : repli propre à un document", () => {
    expect(
      messageErreurApi(new ApiError(500, "Internal server error"), messageRepliArchivage({ categorie: "assurance" }))
    ).toBe("Impossible d'archiver ce document.");
  });
});
