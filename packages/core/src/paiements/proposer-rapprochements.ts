import { montantEnCentimes } from "./montant";

export interface LigneReleveCsvAvecId {
  id: string;
  date: string;
  montant: string;
  libelle: string;
}

export interface PaiementARapprocher {
  id: string;
  montant: string;
  dateEcheance: string;
  // Noms et prénoms des locataires rattachés au bail, en entrées séparées
  // (pas concaténés) : un virement peut ne porter que le nom ou que le
  // prénom du locataire.
  nomsLocataires: string[];
}

export type CritereCorrespondance = "montant" | "date" | "reference";

export interface CandidatRapprochement {
  paiementId: string;
  criteresCorrespondants: CritereCorrespondance[];
}

export interface PropositionRapprochement {
  ligneCsvId: string;
  candidats: CandidatRapprochement[];
}

// Un loyer est couramment viré à quelques jours de l'échéance (avant ou
// après le 1er du mois) — 3 jours s'est avéré trop strict à l'usage
// (constaté en écrivant les tests ci-dessous sur des cas réalistes).
const TOLERANCE_JOURS_DEFAUT = 5;

function differenceEnJours(dateA: string, dateB: string): number {
  const msParJour = 24 * 60 * 60 * 1000;
  return Math.abs(new Date(dateA).getTime() - new Date(dateB).getTime()) / msParJour;
}

function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function libelleContientNom(libelle: string, nom: string): boolean {
  const nomNormalise = normaliser(nom);
  if (nomNormalise === "") {
    return false;
  }
  return normaliser(libelle).includes(nomNormalise);
}

/**
 * Règle de gestion critique (docs/backlog.md, Module 5 — "erreur ici =
 * erreur financière") : propose des rapprochements entre lignes de relevé
 * CSV et paiements attendus, sur trois critères — montant (exact, en
 * centimes, jamais en flottant), date (à `toleranceJours` près de
 * l'échéance) et référence (le libellé CSV contient le nom ou le prénom
 * d'un locataire du bail — correspondance partielle, insensible à la
 * casse/aux accents, ponctuation ignorée).
 *
 * Décision produit tranchée avec l'utilisateur (voir
 * docs/data-dictionary.md, section paiements) :
 * - Cette fonction ne fait JAMAIS que proposer — aucun effet de bord,
 *   aucune écriture. La confirmation reste un acte humain explicite,
 *   toujours, même face à une correspondance sur les trois critères.
 * - Tous les candidats montant+date sont retournés, y compris quand
 *   plusieurs paiements sont candidats à égalité ou qu'aucun nom ne
 *   correspond : jamais de sélection silencieuse d'un seul candidat.
 */
export function proposerRapprochements(
  lignesCsv: LigneReleveCsvAvecId[],
  paiements: PaiementARapprocher[],
  options: { toleranceJours?: number } = {}
): PropositionRapprochement[] {
  const toleranceJours = options.toleranceJours ?? TOLERANCE_JOURS_DEFAUT;
  const propositions: PropositionRapprochement[] = [];

  for (const ligne of lignesCsv) {
    const centimesLigne = montantEnCentimes(ligne.montant);
    const candidats: CandidatRapprochement[] = [];

    for (const paiement of paiements) {
      if (montantEnCentimes(paiement.montant) !== centimesLigne) {
        continue;
      }
      if (differenceEnJours(ligne.date, paiement.dateEcheance) > toleranceJours) {
        continue;
      }

      const criteresCorrespondants: CritereCorrespondance[] = ["montant", "date"];
      const correspondAUnNom = paiement.nomsLocataires.some((nom) => libelleContientNom(ligne.libelle, nom));
      if (correspondAUnNom) {
        criteresCorrespondants.push("reference");
      }

      candidats.push({ paiementId: paiement.id, criteresCorrespondants });
    }

    if (candidats.length > 0) {
      propositions.push({ ligneCsvId: ligne.id, candidats });
    }
  }

  return propositions;
}
