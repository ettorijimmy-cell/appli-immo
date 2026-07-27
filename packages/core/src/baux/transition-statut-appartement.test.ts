import { describe, expect, it } from "vitest";
import {
  calculerStatutAppartementApresResiliation,
  peutActiverBail
} from "./transition-statut-appartement";

describe("peutActiverBail", () => {
  it("autorise l'activation si l'appartement est vacant", () => {
    expect(peutActiverBail("vacant")).toEqual({ ok: true });
  });

  it("refuse l'activation si l'appartement est déjà loué", () => {
    const resultat = peutActiverBail("loue");
    expect(resultat.ok).toBe(false);
    expect(resultat).toMatchObject({ ok: false, raison: expect.stringContaining("vacant") });
  });

  it("refuse l'activation si l'appartement est en travaux", () => {
    expect(peutActiverBail("travaux").ok).toBe(false);
  });

  it("refuse l'activation si l'appartement est archivé", () => {
    expect(peutActiverBail("archive").ok).toBe(false);
  });
});

describe("calculerStatutAppartementApresResiliation", () => {
  it("repasse l'appartement à vacant s'il était loué", () => {
    expect(calculerStatutAppartementApresResiliation("loue")).toBe("vacant");
  });

  it("ne touche pas à un statut modifié manuellement entre-temps (travaux)", () => {
    expect(calculerStatutAppartementApresResiliation("travaux")).toBe("travaux");
  });

  it("laisse vacant inchangé (idempotent)", () => {
    expect(calculerStatutAppartementApresResiliation("vacant")).toBe("vacant");
  });
});
