// Champs d'entrée encore vides (2026-11-06, décision 1 du commit 4) :
// avertissement NON bloquant affiché avant la déclaration d'une entrée
// papier (desktop) et avant la signature numérique d'entrée (mobile). Ni la
// signature ni la déclaration ne l'exigent : c'est un rappel, pas un
// contrôle. Seul l'état d'entrée de chaque élément compte (la description
// reste facultative), plus le nombre et l'état d'entrée des clés et des
// équipements, et l'état d'entrée des lignes d'inventaire déjà saisies.

import {
  ELEMENTS_AUTRE,
  ELEMENTS_CHAMBRE,
  ELEMENTS_CUISINE,
  ELEMENTS_ENTREE,
  ELEMENTS_SALLE_DE_BAIN,
  ELEMENTS_SEJOUR,
  ELEMENTS_WC,
  type ElementDef
} from "./elements-pieces-etat-des-lieux";

type LignePiece = { numero?: number; libelle?: string | null } & Record<string, unknown>;

export interface DonneesChampsEntree {
  // Composition du logement (fiche appartement) : une pièce attendue mais
  // jamais enregistrée compte comme entièrement vide.
  composition: {
    nombreChambres: number | null;
    nombreSallesDeBain: number | null;
    nombreWc: number | null;
    // Libellés des « autres pièces » déclarées (0, 1 ou 2).
    autresPieces: string[];
  };
  entree: LignePiece | null;
  sejour: LignePiece | null;
  cuisine: LignePiece | null;
  chambres: LignePiece[];
  sallesDeBain: LignePiece[];
  wc: LignePiece[];
  autres: LignePiece[];
  cles: { typeCle: string; libelleAutre?: string | null; nombreEntree: number | null }[];
  equipementsDivers: { libelle: string; nombreEntree: number | null; etatEntree: string | null }[];
  inventaire: { etatEntree: string | null }[];
}

export interface ChampsVidesZone {
  zone: string;
  manquants: string[];
}

function vide(valeur: unknown): boolean {
  return valeur === null || valeur === undefined || (typeof valeur === "string" && valeur.trim() === "");
}

function elementsSansEtat(ligne: LignePiece | null | undefined, elements: ElementDef[]): string[] {
  return elements.filter((e) => vide(ligne?.[`${e.prefix}EtatEntree`])).map((e) => e.label);
}

const LIBELLE_CLE: Record<string, string> = {
  immeuble: "Clé de l'immeuble",
  porte_entree: "Clé de la porte d'entrée",
  boite_lettres: "Clé de la boîte aux lettres",
  cave: "Clé de la cave",
  badge_portail: "Badge ou bip du portail",
  parking: "Clé ou bip du parking",
  autre: "Autre clé"
};

export function champsEntreeVides(d: DonneesChampsEntree): ChampsVidesZone[] {
  const zones: ChampsVidesZone[] = [];
  const ajouter = (zone: string, manquants: string[]) => {
    if (manquants.length > 0) {
      zones.push({ zone, manquants });
    }
  };

  ajouter("Entrée", elementsSansEtat(d.entree, ELEMENTS_ENTREE));
  ajouter("Séjour", elementsSansEtat(d.sejour, ELEMENTS_SEJOUR));
  ajouter("Cuisine", elementsSansEtat(d.cuisine, ELEMENTS_CUISINE));

  const parNumero = (lignes: LignePiece[], numero: number) => lignes.find((l) => l.numero === numero) ?? null;
  for (let n = 1; n <= (d.composition.nombreChambres ?? 0); n++) {
    ajouter(`Chambre ${n}`, elementsSansEtat(parNumero(d.chambres, n), ELEMENTS_CHAMBRE));
  }
  for (let n = 1; n <= (d.composition.nombreSallesDeBain ?? 0); n++) {
    ajouter(`Salle de bain ${n}`, elementsSansEtat(parNumero(d.sallesDeBain, n), ELEMENTS_SALLE_DE_BAIN));
  }
  for (let n = 1; n <= (d.composition.nombreWc ?? 0); n++) {
    ajouter(`WC ${n}`, elementsSansEtat(parNumero(d.wc, n), ELEMENTS_WC));
  }
  d.composition.autresPieces.forEach((libelle, i) => {
    const ligne = parNumero(d.autres, i + 1);
    ajouter(ligne?.libelle?.trim() || libelle, elementsSansEtat(ligne, ELEMENTS_AUTRE));
  });

  if (d.cles.length === 0) {
    ajouter("Clés", ["Aucune clé saisie"]);
  } else {
    ajouter(
      "Clés",
      d.cles
        .filter((c) => vide(c.nombreEntree))
        .map((c) => (c.typeCle === "autre" && c.libelleAutre?.trim()) || LIBELLE_CLE[c.typeCle] || c.typeCle)
    );
  }
  ajouter(
    "Équipements divers",
    d.equipementsDivers.filter((e) => vide(e.nombreEntree) || vide(e.etatEntree)).map((e) => e.libelle)
  );
  const inventaireSansEtat = d.inventaire.filter((l) => vide(l.etatEntree)).length;
  if (inventaireSansEtat > 0) {
    ajouter("Inventaire", [`${inventaireSansEtat} ligne(s) sans état d'entrée`]);
  }
  return zones;
}
