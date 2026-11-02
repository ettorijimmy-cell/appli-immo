import { describe, expect, it } from "vitest";
import { nettoyerTexteObservation, observationSortieASoumettre } from "./observations-etat-des-lieux";

describe("nettoyerTexteObservation", () => {
  it("retire les espaces autour, garde le texte tel quel", () => {
    expect(nettoyerTexteObservation("  Trace sur le mur du séjour \n")).toBe("Trace sur le mur du séjour");
  });

  it("unifie les fins de ligne et garde les retours à la ligne", () => {
    expect(nettoyerTexteObservation("Ligne 1\r\nLigne 2\rLigne 3\nLigne 4")).toBe("Ligne 1\nLigne 2\nLigne 3\nLigne 4");
  });

  it("garde les tabulations et les accents", () => {
    expect(nettoyerTexteObservation("Élément\tdégradé")).toBe("Élément\tdégradé");
  });

  it("retire les caractères de contrôle, invalides dans le XML du document", () => {
    expect(nettoyerTexteObservation("Avant\u0000\u0007\u000B\u001F\u007FAprès")).toBe("AvantAprès");
  });

  it("une saisie vide ou blanche revient à ne rien saisir", () => {
    expect(nettoyerTexteObservation("")).toBeNull();
    expect(nettoyerTexteObservation("  \n\t ")).toBeNull();
    expect(nettoyerTexteObservation("\u0000")).toBeNull();
  });
});

describe("observationSortieASoumettre", () => {
  it("ne soumet rien quand rien n'est saisi ni enregistré", () => {
    expect(observationSortieASoumettre("  ", null)).toBeUndefined();
    expect(observationSortieASoumettre("", undefined)).toBeUndefined();
  });

  it("soumet le texte nettoyé", () => {
    expect(observationSortieASoumettre("  Trace au mur \r\nà droite ", null)).toBe("Trace au mur \nà droite");
  });

  it("soumet null pour effacer un texte déjà enregistré", () => {
    expect(observationSortieASoumettre(" ", "Ancien texte")).toBeNull();
  });
});
