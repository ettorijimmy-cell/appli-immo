import { describe, expect, it } from "vitest";
import { resoudreBasename } from "./base-path";

describe("resoudreBasename", () => {
  it("\"/\" reste \"/\" (racine, aucun préfixe — défaut de BrowserRouter)", () => {
    expect(resoudreBasename("/")).toBe("/");
  });

  it("\"/mobile/\" perd sa barre finale", () => {
    expect(resoudreBasename("/mobile/")).toBe("/mobile");
  });

  it("un préfixe imbriqué perd aussi sa barre finale", () => {
    expect(resoudreBasename("/app/mobile/")).toBe("/app/mobile");
  });
});
