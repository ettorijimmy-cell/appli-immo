import { describe, expect, it } from "vitest";
import {
  calculerAlerteBailFinProche,
  calculerAlerteDocumentExpire,
  calculerAlerteDocumentExpireProche,
  calculerAlerteEntretienEquipement,
  calculerAlerteImpaye,
  calculerProchaineDateEntretien
} from "./regles-alertes";

describe("calculerAlerteBailFinProche", () => {
  it("ne se déclenche pas sans date de fin", () => {
    expect(calculerAlerteBailFinProche(null, 30, "2026-07-01")).toBe(false);
  });
  it("ne se déclenche pas avant l'entrée dans la fenêtre de seuil", () => {
    expect(calculerAlerteBailFinProche("2026-08-31", 30, "2026-07-01")).toBe(false);
  });
  it("se déclenche exactement au premier jour de la fenêtre", () => {
    expect(calculerAlerteBailFinProche("2026-08-31", 30, "2026-08-01")).toBe(true);
  });
  it("reste déclenchée après la date de fin (non traitée)", () => {
    expect(calculerAlerteBailFinProche("2026-06-15", 30, "2026-07-01")).toBe(true);
  });
});

describe("calculerAlerteDocumentExpire", () => {
  it("se déclenche si le statut calculé est expire", () => {
    expect(calculerAlerteDocumentExpire("expire")).toBe(true);
  });
  it("ne se déclenche pas si valide ou archive", () => {
    expect(calculerAlerteDocumentExpire("valide")).toBe(false);
    expect(calculerAlerteDocumentExpire("archive")).toBe(false);
  });
});

describe("calculerAlerteDocumentExpireProche", () => {
  it("ne se déclenche pas sans date d'expiration", () => {
    expect(calculerAlerteDocumentExpireProche(null, "valide", 15, "2026-07-01")).toBe(false);
  });
  it("ne se déclenche pas si déjà expire (relais pris par document_expire)", () => {
    expect(calculerAlerteDocumentExpireProche("2026-06-01", "expire", 15, "2026-07-01")).toBe(false);
  });
  it("ne se déclenche pas avant la fenêtre de seuil", () => {
    expect(calculerAlerteDocumentExpireProche("2026-08-31", "valide", 15, "2026-07-01")).toBe(false);
  });
  it("se déclenche dans la fenêtre de seuil tant que valide", () => {
    expect(calculerAlerteDocumentExpireProche("2026-07-20", "valide", 15, "2026-07-10")).toBe(true);
  });
});

describe("calculerProchaineDateEntretien", () => {
  it("ajoute l'intervalle en mois à la dernière date d'entretien", () => {
    expect(calculerProchaineDateEntretien("2025-06-15", 12)).toBe("2026-06-15");
  });
});

describe("calculerAlerteEntretienEquipement", () => {
  it("ne se déclenche pas sans date de dernier entretien", () => {
    expect(calculerAlerteEntretienEquipement(null, 12, 30, "2026-07-01")).toBe(false);
  });
  it("ne se déclenche pas sans intervalle renseigné", () => {
    expect(calculerAlerteEntretienEquipement("2025-06-15", null, 30, "2026-07-01")).toBe(false);
  });
  it("ne se déclenche pas avant la fenêtre de seuil", () => {
    expect(calculerAlerteEntretienEquipement("2025-06-15", 12, 30, "2026-05-01")).toBe(false);
  });
  it("se déclenche dans la fenêtre de seuil avant la prochaine échéance d'entretien", () => {
    expect(calculerAlerteEntretienEquipement("2025-06-15", 12, 30, "2026-06-01")).toBe(true);
  });
  it("reste déclenchée après la prochaine date d'entretien", () => {
    expect(calculerAlerteEntretienEquipement("2025-06-15", 12, 30, "2026-08-01")).toBe(true);
  });
});

describe("calculerAlerteImpaye", () => {
  it("ne se déclenche pas avant la fin du délai de grâce", () => {
    expect(calculerAlerteImpaye("2026-07-05", 5, "2026-07-08")).toBe(false);
  });
  it("le dernier jour du délai de grâce est encore toléré", () => {
    expect(calculerAlerteImpaye("2026-07-05", 5, "2026-07-10")).toBe(false);
  });
  it("se déclenche le lendemain de la fin du délai de grâce", () => {
    expect(calculerAlerteImpaye("2026-07-05", 5, "2026-07-11")).toBe(true);
  });
  it("se déclenche largement après le délai de grâce", () => {
    expect(calculerAlerteImpaye("2026-01-05", 5, "2026-07-10")).toBe(true);
  });
  it("avec un délai de grâce nul, la date d'échéance elle-même est encore tolérée", () => {
    expect(calculerAlerteImpaye("2026-07-05", 0, "2026-07-05")).toBe(false);
  });
  it("avec un délai de grâce nul, se déclenche dès le lendemain de l'échéance", () => {
    expect(calculerAlerteImpaye("2026-07-05", 0, "2026-07-06")).toBe(true);
  });
});
