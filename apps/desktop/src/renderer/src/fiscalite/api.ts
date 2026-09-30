import { authenticatedFetch } from "../lib/authenticated-fetch";

export interface Annexe1Calculee {
  ligne1: string;
  ligne2: string;
  ligne3: string;
  ligne4: string;
  ligne5: string;
  ligne6: string;
  ligne7: string;
  ligne8: string;
  ligne9: string;
  ligne9Bis: string;
  ligne10: string;
  ligne11: string;
  ligne12: string;
  ligne13: string;
  ligne14: string;
  ligne15: string;
  ligne16: string;
  ligne17: string;
  ligne18: string;
  ligne19: string;
  ligne20: string;
  ligne21: string;
  ligne22: string;
  ligne23: string;
}

// Champs de saisie manuelle (2072-S-A1-SD) — voir packages/core,
// calculer-annexe1.ts pour le détail de chaque ligne. null = valeur
// jamais saisie ou effacée, traitée comme 0 dans les totaux.
export interface Annexe1SaisieManuelle {
  ligne2?: string | null;
  ligne3?: string | null;
  ligne4?: string | null;
  ligne9Bis?: string | null;
  ligne10?: string | null;
  ligne11?: string | null;
  ligne14?: string | null;
  ligne15?: string | null;
  ligne19?: string | null;
  ligne20?: string | null;
  ligne22?: string | null;
}

export interface Annexe1ProrataApplique {
  ligne: "ligne6" | "ligne8" | "ligne9" | "ligne12" | "ligne13" | "ligne17";
  montant: string;
}

export interface Annexe1ResultatBien {
  bienId: string;
  nombreLots: number;
  lignes: Annexe1Calculee;
  saisieManuelle: Annexe1SaisieManuelle;
  proratasAppliques: Annexe1ProrataApplique[];
}

export interface Annexe1Resultat {
  sciId: string;
  sciNom: string;
  annee: number;
  biens: Annexe1ResultatBien[];
  totalSci: string;
}

export function getAnnexe1(sciId: string, annee: number): Promise<Annexe1Resultat> {
  return authenticatedFetch<Annexe1Resultat>(`/fiscalite/annexe1?sciId=${sciId}&annee=${annee}`);
}

export function sauvegarderSaisieManuelleAnnexe1(
  bienId: string,
  annee: number,
  dto: Annexe1SaisieManuelle
): Promise<Annexe1SaisieManuelle> {
  return authenticatedFetch<Annexe1SaisieManuelle>(`/fiscalite/annexe1/${bienId}/${annee}`, {
    method: "PATCH",
    body: JSON.stringify(dto)
  });
}

// Formulaire 2044 (revenus fonciers, régime réel) — biens détenus en nom
// propre. Périmètre resserré à 4 lignes automatiques (221/223/224/227) et
// au résultat (211-215, 261/263) — voir packages/core/src/fiscalite/
// calculer-2044.ts pour le détail des lignes exclues et pourquoi. Aucune
// saisie manuelle pour l'instant, contrairement à l'Annexe 1 (2072-S).
export interface Formulaire2044Calcule {
  ligne211: string;
  ligne212: string;
  ligne213: string;
  ligne215: string;
  ligne221: string;
  ligne223: string;
  ligne224: string;
  ligne227: string;
  ligne240: string;
  ligne261: string;
  ligne263: string;
}

export interface Formulaire2044Resultat {
  bienId: string;
  annee: number;
  lignes: Formulaire2044Calcule;
}

export function getFormulaire2044(bienId: string, annee: number): Promise<Formulaire2044Resultat> {
  return authenticatedFetch<Formulaire2044Resultat>(`/fiscalite/2044?bienId=${bienId}&annee=${annee}`);
}
