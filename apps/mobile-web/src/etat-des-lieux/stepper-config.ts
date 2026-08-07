import type { BailTypeBail } from "../api/patrimoine";
import type { Appartement } from "../api/patrimoine";

export type EtapeType =
  | "piece-entree"
  | "piece-sejour"
  | "piece-cuisine"
  | "piece-chambre"
  | "piece-salle-de-bain"
  | "piece-wc"
  | "piece-autre"
  | "compteurs"
  | "cles"
  | "equipements-divers"
  | "inventaire"
  | "recap";

export interface Etape {
  type: EtapeType;
  titre: string;
  numero?: number;
}

// Génère la séquence exacte d'étapes depuis la composition réelle de
// l'appartement (nombre_chambres/nombre_salles_de_bain/nombre_wc/
// autre_piece_1/2) — jamais un maximum fixe ni une question reposée ici :
// EtatDesLieuxPage bloque déjà en amont si ces champs sont absents
// (validerCompletudeEtatDesLieux). "Entrée 1/N" : N dépend donc du
// logement précis, pas d'un total générique.
export function construireEtapes(appartement: Appartement, typeBail: BailTypeBail): Etape[] {
  const etapes: Etape[] = [
    { type: "piece-entree", titre: "Entrée" },
    { type: "piece-sejour", titre: "Séjour" },
    { type: "piece-cuisine", titre: "Cuisine" }
  ];

  for (let n = 1; n <= (appartement.nombreChambres ?? 0); n++) {
    etapes.push({ type: "piece-chambre", titre: `Chambre ${n}`, numero: n });
  }
  for (let n = 1; n <= (appartement.nombreSallesDeBain ?? 0); n++) {
    etapes.push({ type: "piece-salle-de-bain", titre: `Salle de bain ${n}`, numero: n });
  }
  for (let n = 1; n <= (appartement.nombreWc ?? 0); n++) {
    etapes.push({ type: "piece-wc", titre: `WC ${n}`, numero: n });
  }
  if (appartement.autrePiece1) {
    etapes.push({ type: "piece-autre", titre: appartement.autrePiece1, numero: 1 });
  }
  if (appartement.autrePiece2) {
    etapes.push({ type: "piece-autre", titre: appartement.autrePiece2, numero: 2 });
  }

  etapes.push({ type: "compteurs", titre: "Compteurs" });
  etapes.push({ type: "cles", titre: "Clés" });
  etapes.push({ type: "equipements-divers", titre: "Équipements divers" });
  if (typeBail === "meuble") {
    etapes.push({ type: "inventaire", titre: "Inventaire meublé" });
  }
  etapes.push({ type: "recap", titre: "Terminer" });

  return etapes;
}
