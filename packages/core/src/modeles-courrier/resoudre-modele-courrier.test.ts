import { describe, expect, it } from "vitest";
import { resoudreModeleCourrier } from "./resoudre-modele-courrier";

describe("resoudreModeleCourrier", () => {
  it("remplace une variable simple dans le corps et l'objet", () => {
    const resultat = resoudreModeleCourrier(
      { objet: "Bonjour {{prenom}}", corps: "Contenu pour {{prenom}}." },
      { prenom: "Ilan" }
    );
    expect(resultat).toEqual({ objet: "Bonjour Ilan", corps: "Contenu pour Ilan." });
  });

  it("remplace plusieurs occurrences de la même variable", () => {
    const resultat = resoudreModeleCourrier(
      { objet: null, corps: "{{nom}} - {{nom}} - {{nom}}" },
      { nom: "Devos" }
    );
    expect(resultat.corps).toBe("Devos - Devos - Devos");
  });

  it("lève une erreur explicite listant la variable manquante", () => {
    expect(() => resoudreModeleCourrier({ objet: null, corps: "Bonjour {{prenom}}" }, {})).toThrow(/prenom/);
  });

  it("lève une erreur listant toutes les variables manquantes (corps et objet), sans doublon", () => {
    expect(() =>
      resoudreModeleCourrier(
        { objet: "{{prenom}} - {{manquante1}}", corps: "{{manquante1}} et {{manquante2}}" },
        { prenom: "Ilan" }
      )
    ).toThrow(/manquante1.*manquante2|manquante2.*manquante1/);
  });

  it("modèle sans aucune variable : passthrough exact", () => {
    const resultat = resoudreModeleCourrier({ objet: "Sujet fixe", corps: "Corps fixe, rien à substituer." }, {});
    expect(resultat).toEqual({ objet: "Sujet fixe", corps: "Corps fixe, rien à substituer." });
  });

  it("objet null : passthrough sans erreur, corps résolu normalement", () => {
    const resultat = resoudreModeleCourrier({ objet: null, corps: "Bonjour {{prenom}}" }, { prenom: "Ilan" });
    expect(resultat).toEqual({ objet: null, corps: "Bonjour Ilan" });
  });

  it("des variables fournies en excès (non référencées dans le modèle) sont ignorées sans erreur", () => {
    const resultat = resoudreModeleCourrier(
      { objet: null, corps: "Bonjour {{prenom}}" },
      { prenom: "Ilan", nonUtilisee: "peu importe" }
    );
    expect(resultat.corps).toBe("Bonjour Ilan");
  });

  it("une variable manquante parmi plusieurs : seule la manquante est signalée, pas celle déjà résolue", () => {
    expect(() => resoudreModeleCourrier({ objet: null, corps: "{{a}} {{b}}" }, { a: "valeur-a" })).toThrow(
      "Variable(s) manquante(s) pour la résolution du modèle de courrier : b"
    );
  });
});
