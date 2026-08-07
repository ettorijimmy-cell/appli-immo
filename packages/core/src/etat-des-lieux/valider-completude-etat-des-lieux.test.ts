import { describe, expect, it } from "vitest";
import { validerCompletudeEtatDesLieux } from "./valider-completude-etat-des-lieux";

const COMPLET = { nombreChambres: 2, nombreSallesDeBain: 1, nombreWc: 1 };

describe("validerCompletudeEtatDesLieux", () => {
  it("aucun champ manquant quand la composition est complète, y compris à zéro", () => {
    expect(validerCompletudeEtatDesLieux(COMPLET)).toEqual([]);
    expect(validerCompletudeEtatDesLieux({ nombreChambres: 0, nombreSallesDeBain: 0, nombreWc: 0 })).toEqual([]);
  });

  it("liste les trois champs manquants en un seul appel, pas un blocage au premier trouvé", () => {
    const manquants = validerCompletudeEtatDesLieux({
      nombreChambres: null,
      nombreSallesDeBain: null,
      nombreWc: null
    });
    expect(manquants).toEqual([
      "Nombre de chambres de l'appartement",
      "Nombre de salles de bain de l'appartement",
      "Nombre de WC de l'appartement"
    ]);
  });

  it("signale un seul champ manquant quand les deux autres sont renseignés", () => {
    expect(validerCompletudeEtatDesLieux({ ...COMPLET, nombreWc: null })).toEqual([
      "Nombre de WC de l'appartement"
    ]);
  });
});
