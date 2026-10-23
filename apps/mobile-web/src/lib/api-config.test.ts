import { describe, expect, it } from "vitest";
import { resoudreApiBaseUrl } from "./api-config";

describe("resoudreApiBaseUrl", () => {
  it("production, VITE_API_URL absent : URL relative (même origine que le backend sous /mobile/)", () => {
    expect(resoudreApiBaseUrl(undefined, true)).toBe("");
  });

  it("production, VITE_API_URL défini : utilisée telle quelle (réversibilité, hébergement séparé)", () => {
    expect(resoudreApiBaseUrl("https://api.exemple.fr-par.scw.cloud", true)).toBe(
      "https://api.exemple.fr-par.scw.cloud"
    );
  });

  it("développement, VITE_API_URL absent : repli sur localhost:3000 (inchangé)", () => {
    expect(resoudreApiBaseUrl(undefined, false)).toBe("http://localhost:3000");
  });

  it("développement, VITE_API_URL défini : utilisée telle quelle (ex. test réel depuis un téléphone en LAN)", () => {
    expect(resoudreApiBaseUrl("http://192.168.1.245:3000", false)).toBe("http://192.168.1.245:3000");
  });

  it("chaîne vide explicite traitée comme absente : repli appliqué, jamais une URL relative forcée en dev", () => {
    expect(resoudreApiBaseUrl("", false)).toBe("http://localhost:3000");
  });
});
