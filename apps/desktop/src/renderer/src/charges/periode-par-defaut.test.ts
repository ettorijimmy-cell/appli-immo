import { describe, expect, it } from "vitest";
import { calculerPeriodeParDefaut } from "./periode-par-defaut";

// Scénario explicitement demandé par Jimmy après avoir repéré un off-by-one
// suspecté : bail commencé il y a plusieurs mois, calcul déclenché
// aujourd'hui, jamais un cas limite d'un jour qui masquerait un décalage
// réel. Confirme que la formule elle-même n'a pas l'off-by-one rapporté —
// le vrai bug était une fuite de l'historique du bail précédent pendant le
// chargement du nouveau (voir ChargesView.tsx).
describe("calculerPeriodeParDefaut", () => {
  it("reprend le début du bail quand aucun bilan n'existe encore (bail commencé plusieurs mois avant un calcul déclenché aujourd'hui)", () => {
    const bail = { dateDebut: "2026-03-15", dateFin: null };
    const resultat = calculerPeriodeParDefaut(null, bail, "2026-10-02");

    expect(resultat.periodeDebut).toBe("2026-03-15");
    expect(resultat.periodeFin).toBe("2026-10-02");
  });

  it("reprend la fin du dernier bilan persisté plutôt que le début du bail, si un bilan existe déjà", () => {
    const bail = { dateDebut: "2025-01-01", dateFin: null };
    const bilan = { periodeFin: "2026-01-01" };

    expect(calculerPeriodeParDefaut(bilan, bail, "2026-10-02").periodeDebut).toBe("2026-01-01");
  });

  it("plafonne periodeFin à la date de fin réelle du bail s'il est résilié, même si aujourd'hui est postérieur", () => {
    const bail = { dateDebut: "2025-01-01", dateFin: "2026-06-15" };

    expect(calculerPeriodeParDefaut(null, bail, "2026-10-02").periodeFin).toBe("2026-06-15");
  });

  it("retombe sur aujourd'hui si le bail n'a pas de date de fin (toujours actif)", () => {
    const bail = { dateDebut: "2025-01-01", dateFin: null };

    expect(calculerPeriodeParDefaut(null, bail, "2026-10-02").periodeFin).toBe("2026-10-02");
  });

  it("retourne periodeDebut vide si aucun bail n'est encore résolu (sélection en cours de chargement)", () => {
    expect(calculerPeriodeParDefaut(null, null, "2026-10-02").periodeDebut).toBe("");
  });
});
