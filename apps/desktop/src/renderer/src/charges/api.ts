import { authenticatedFetch } from "../lib/authenticated-fetch";

// Miroir de SensBilanRegularisation (packages/core/src/charges/
// calculer-bilan-regularisation.ts).
export type SensBilanRegularisation = "faveur_locataire" | "faveur_proprietaire" | "equilibre";

export const LIBELLE_SENS_BILAN: Record<SensBilanRegularisation, string> = {
  faveur_locataire: "En faveur du locataire",
  faveur_proprietaire: "En faveur du propriétaire",
  equilibre: "À l'équilibre"
};

// Module Régularisation des charges, Sous-commit F — un bilan déjà calculé
// et persisté (bilan_regularisation_charges), par opposition au résultat
// d'un déclenchement (ResultatDeclenchementRegularisation ci-dessous).
export interface BilanRegularisationPersiste {
  id: string;
  bailId: string;
  periodeDebut: string;
  periodeFin: string;
  provisionsRecues: string;
  chargesReelles: string;
  solde: string;
  sens: SensBilanRegularisation;
  tacheId: string | null;
  createdAt: string;
}

export interface ResultatDeclenchementRegularisation {
  bailId: string;
  periodeDebut: string;
  periodeFin: string;
  provisionsRecues: string;
  chargesReelles: string;
  solde: string;
  sens: SensBilanRegularisation;
  tacheCreee: boolean;
  tacheId: string | null;
}

// Lecture seule — ne déclenche jamais aucun calcul ni création de tâche
// (voir BauxRegularisationChargesController.historique). Triés du plus
// récent au plus ancien par periodeFin par le backend.
export function getHistoriqueRegularisation(bailId: string): Promise<BilanRegularisationPersiste[]> {
  return authenticatedFetch<BilanRegularisationPersiste[]>(`/baux/${bailId}/regularisation-charges/historique`);
}

// Calcule ET persiste le bilan (toujours), et crée une tâche de rappel si
// sens='faveur_proprietaire' et qu'aucune tâche active n'existe déjà pour
// cette période exacte — voir TachesJobService.
// genererTacheRegularisationSiNecessaire. periodeDebut/periodeFin
// explicites, jamais déduits implicitement de la date du jour (décision
// actée, Sous-commit C) : un déclenchement manuel sert aussi à un départ
// anticipé de locataire, période qui ne peut pas se deviner.
export function declencherRegularisation(
  bailId: string,
  periodeDebut: string,
  periodeFin: string
): Promise<ResultatDeclenchementRegularisation> {
  return authenticatedFetch<ResultatDeclenchementRegularisation>(`/baux/${bailId}/regularisation-charges`, {
    method: "POST",
    body: JSON.stringify({ periodeDebut, periodeFin })
  });
}
