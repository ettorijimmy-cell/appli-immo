import { describe, expect, it } from "vitest";
import { preremplirLoyerBail } from "./preremplir-loyer-bail";

describe("preremplirLoyerBail", () => {
  it("utilise la référence de l'appartement si aucun loyer n'est saisi", () => {
    expect(preremplirLoyerBail(undefined, "850.00")).toBe("850.00");
  });

  it("retourne null si aucun loyer n'est saisi et l'appartement n'a pas de référence", () => {
    expect(preremplirLoyerBail(undefined, null)).toBeNull();
  });

  it("privilégie toujours la saisie explicite, même différente de la référence", () => {
    expect(preremplirLoyerBail("900.00", "850.00")).toBe("900.00");
  });

  it("respecte une saisie explicite vide plutôt que de retomber sur la référence", () => {
    expect(preremplirLoyerBail("", "850.00")).toBe("");
  });
});
