import { describe, expect, it } from "vitest";
import { trouverBalisesDesequilibrees } from "./trouver-balises-desequilibrees";

describe("trouverBalisesDesequilibrees", () => {
  it("ne signale rien quand toutes les boucles sont bien fermées", () => {
    const texte = "{#chambres}{titre}{#photos}{%.}{/photos}{/chambres}{#sections}{titreSection}{/sections}";
    expect(trouverBalisesDesequilibrees(texte)).toEqual([]);
  });

  it("détecte une fermeture manquante (scénario réel : {/meublé} disparu)", () => {
    const texte = "{#meublé}I N V E N T A I R E{#sections}{titreSection}{/sections}";
    const resultat = trouverBalisesDesequilibrees(texte);
    expect(resultat).toContainEqual({ nom: "meublé", ouvertures: 1, fermetures: 0 });
  });

  it("détecte une ouverture manquante (fermeture en surnombre)", () => {
    const texte = "{#chambres}{/chambres}{/chambres}";
    const resultat = trouverBalisesDesequilibrees(texte);
    expect(resultat).toContainEqual({ nom: "chambres", ouvertures: 1, fermetures: 2 });
  });

  it("compte correctement le même nom de bloc réutilisé à plusieurs endroits (ex. {#photos} dans chambres/sallesDeBain/wc)", () => {
    const texte =
      "{#chambres}{#photos}{%.}{/photos}{/chambres}{#sallesDeBain}{#photos}{%.}{/photos}{/sallesDeBain}{#wc}{#photos}{%.}{/photos}{/wc}";
    expect(trouverBalisesDesequilibrees(texte)).toEqual([]);
  });

  it("ignore les balises non-bloc (pas de # ni /)", () => {
    const texte = "{Nom de la SCI}{titreSection}{libelle}";
    expect(trouverBalisesDesequilibrees(texte)).toEqual([]);
  });
});
