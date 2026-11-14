import { estDateIsoValide } from "../dates/calendrier";
import { calculerMontantRecuTotal, type VersementActif } from "../paiements/calculer-montant-recu-total";
import { calculerStatutPaiement, type StatutPaiement } from "../paiements/calculer-statut-paiement";
import { centimesVersMontant, montantEnCentimes } from "../paiements/montant";
import { calculerDecompositionEcheanceFin, type DecompositionEcheanceEntree } from "./echeances";

// Clôture financière d'un bail résilié (chantier financier de la
// résiliation, conception 1, décisions de Jimmy du 2026-11-14 —
// tmp/decisions-resiliation.md, reportées dans docs/backlog.md au commit
// de documentation). Fonctions pures : BauxService.resilier(), la quittance
// et les remboursements en attente les appellent avec des données déjà
// lues en base, et décident seuls des écritures.
//
// Montants : chaînes décimales en entrée et en sortie, comme le reste de
// packages/core (echeances.ts, calculerStatutPaiement), calculés en
// centimes entiers (montantEnCentimes / centimesVersMontant), jamais en
// flottant. Dates : AAAA-MM-JJ, vérifiées (erreur sinon).

/**
 * Position d'une échéance de loyer par rapport au mois de `date_fin`,
 * selon le MOIS de sa `date_echeance` (le jour n'intervient pas) : une
 * échéance datée du 05/03 et une fin au 15/03 sont dans le même mois.
 */
export type PositionEcheanceFinBail = "avant_mois_fin" | "mois_fin" | "apres_mois_fin";

export function classerEcheanceParRapportAFin(dateEcheance: string, dateFin: string): PositionEcheanceFinBail {
  verifierDateIso(dateEcheance, "date d'échéance");
  verifierDateIso(dateFin, "date de fin");
  // AAAA-MM se compare correctement comme chaîne (longueurs fixes).
  const moisEcheance = dateEcheance.slice(0, 7);
  const moisFin = dateFin.slice(0, 7);
  if (moisEcheance < moisFin) {
    return "avant_mois_fin";
  }
  if (moisEcheance === moisFin) {
    return "mois_fin";
  }
  return "apres_mois_fin";
}

export interface EcheancesClasseesFinBail<T> {
  avantMoisFin: T[];
  moisFin: T[];
  apresMoisFin: T[];
}

/** Répartit des échéances de loyer selon `classerEcheanceParRapportAFin`, ordre d'entrée conservé. */
export function classerEcheancesParRapportAFin<T extends { dateEcheance: string }>(
  echeances: readonly T[],
  dateFin: string
): EcheancesClasseesFinBail<T> {
  const resultat: EcheancesClasseesFinBail<T> = { avantMoisFin: [], moisFin: [], apresMoisFin: [] };
  for (const echeance of echeances) {
    const position = classerEcheanceParRapportAFin(echeance.dateEcheance, dateFin);
    if (position === "avant_mois_fin") {
      resultat.avantMoisFin.push(echeance);
    } else if (position === "mois_fin") {
      resultat.moisFin.push(echeance);
    } else {
      resultat.apresMoisFin.push(echeance);
    }
  }
  return resultat;
}

/**
 * Sort d'une échéance de loyer d'un mois strictement après le mois de fin
 * (décision 5) : archivée si elle n'a AUCUN versement actif ; sinon
 * conservée, montant inchangé, et tout ce qui a été reçu est un trop-perçu
 * (le mois n'est pas dû). Les versements archivés ne comptent jamais.
 * Jamais de suppression, jamais de remboursement automatique : l'appelant
 * signale le trop-perçu, un remboursement reste un acte humain.
 */
export type DecisionEcheanceApresFin = { decision: "archiver" } | { decision: "conserver"; tropPercu: string };

//
// Un versement actif de 0,00 € suffit à conserver l'échéance (trop-perçu
// "0.00") : la règle est « aucun versement actif », pas « rien reçu », et
// une trace de versement ne doit pas disparaître avec son échéance. Un
// versement actif négatif est une donnée incohérente (le DTO de versement
// ne le refuse pas encore) : erreur plutôt qu'un trop-perçu faux.
export function deciderEcheanceApresFin(versements: readonly VersementActif[]): DecisionEcheanceApresFin {
  const versementsActifs = versementsActifsVerifies(versements);
  if (versementsActifs.length === 0) {
    return { decision: "archiver" };
  }
  return { decision: "conserver", tropPercu: calculerMontantRecuTotal(versementsActifs) };
}

function versementsActifsVerifies(versements: readonly VersementActif[]): VersementActif[] {
  const versementsActifs = versements.filter((versement) => versement.archivedAt === null);
  for (const versement of versementsActifs) {
    if (montantEnCentimes(versement.montant) < 0) {
      throw new Error(`Versement actif négatif : "${versement.montant}".`);
    }
  }
  return versementsActifs;
}

export interface BailClotureFinanciere {
  loyerMensuel: string;
  provisionsCharges: string | null;
  dateDebut: string;
}

export interface EcheanceMoisFinExistante {
  statut: StatutPaiement;
  versements: readonly VersementActif[];
}

export interface MiseAJourEcheanceMoisFin extends DecompositionEcheanceEntree {
  statut: StatutPaiement;
}

export interface ResultatEcheanceMoisFin {
  /** null : échéance déjà payée, laissée telle quelle (décision 6). */
  miseAJour: MiseAJourEcheanceMoisFin | null;
  /** max(0, reçu actif − prorata), "0.00" si rien de trop. */
  tropPercu: string;
}

/**
 * Cas A — une échéance couvre déjà le mois de fin (décision 6). Impayée
 * ou partielle : montant ET décomposition recalculés au prorata, statut
 * recalculé d'après les versements actifs (calculerStatutPaiement, règle
 * existante). Payée : rien n'est modifié. Dans les deux cas le trop-perçu
 * est comparé au montant réellement dû (le prorata), comme aujourd'hui
 * dans BauxService.resilier().
 */
export function recalculerEcheanceMoisFin(
  echeance: EcheanceMoisFinExistante,
  bail: BailClotureFinanciere,
  dateFin: string
): ResultatEcheanceMoisFin {
  const prorata = calculerDecompositionEcheanceFin(bail.loyerMensuel, bail.provisionsCharges, bail.dateDebut, dateFin);
  const montantRecu = calculerMontantRecuTotal(versementsActifsVerifies(echeance.versements));
  const centimesTropPercu = Math.max(0, montantEnCentimes(montantRecu) - montantEnCentimes(prorata.montant));
  const tropPercu = centimesVersMontant(centimesTropPercu);

  if (echeance.statut === "paye") {
    return { miseAJour: null, tropPercu };
  }
  return {
    miseAJour: { ...prorata, statut: calculerStatutPaiement(prorata.montant, montantRecu) },
    tropPercu
  };
}

/**
 * Cas B — aucune échéance ne couvre le mois de fin : l'échéance à créer,
 * décomposition comprise (décision 6), ou null si le prorata est nul (rien
 * à facturer, comme aujourd'hui).
 */
export function calculerEcheanceMoisFinACreer(
  bail: BailClotureFinanciere,
  dateFin: string
): DecompositionEcheanceEntree | null {
  const prorata = calculerDecompositionEcheanceFin(bail.loyerMensuel, bail.provisionsCharges, bail.dateDebut, dateFin);
  return montantEnCentimes(prorata.montant) > 0 ? prorata : null;
}

/**
 * Trop-perçu total d'une résiliation : celui du mois de fin (Cas A, null
 * en Cas B ou sans échéance) + celui de chaque échéance conservée après la
 * fin. Les échéances archivées n'ont, par construction, aucun versement.
 */
export function calculerTropPercuTotalResiliation(
  tropPercuMoisFin: string | null,
  decisionsApresFin: readonly DecisionEcheanceApresFin[]
): string {
  let centimes = tropPercuMoisFin === null ? 0 : centimesTropPercuVerifies(tropPercuMoisFin);
  for (const decision of decisionsApresFin) {
    if (decision.decision === "conserver") {
      centimes += centimesTropPercuVerifies(decision.tropPercu);
    }
  }
  return centimesVersMontant(centimes);
}

function centimesTropPercuVerifies(tropPercu: string): number {
  const centimes = montantEnCentimes(tropPercu);
  if (centimes < 0) {
    throw new Error(`Trop-perçu négatif : "${tropPercu}".`);
  }
  return centimes;
}

/**
 * Reste à rembourser sur UN paiement : max(0, trop-perçu − remboursements
 * actifs de ce paiement). Les remboursements sont rattachés à un paiement
 * précis (`remboursements.paiement_id`) : la déduction se fait paiement par
 * paiement, jamais sur un total global — sans quoi un remboursement saisi
 * sur un mois pourrait masquer le trop-perçu d'un autre. Les remboursements
 * archivés ne comptent pas. Sert aux remboursements en attente du tableau
 * de bord (décision 8) et à la réponse de la résiliation.
 */
export interface RemboursementSaisi {
  montantRembourse: string;
  archivedAt: Date | string | null;
}

export function calculerResteARembourser(tropPercu: string, remboursements: readonly RemboursementSaisi[]): string {
  const centimesTropPercu = centimesTropPercuVerifies(tropPercu);
  const centimesRembourses = remboursements
    .filter((remboursement) => remboursement.archivedAt === null)
    .reduce((total, remboursement) => total + montantEnCentimes(remboursement.montantRembourse), 0);
  return centimesVersMontant(Math.max(0, centimesTropPercu - centimesRembourses));
}

/** Valeurs de l'enum `bail_statut` (packages/db/src/schema/baux.ts). */
export type StatutBail = "brouillon" | "actif" | "preavis" | "resilie" | "archive";

export interface BailPourQuittance {
  statut: StatutBail;
  dateFin: string | null;
}

/**
 * Mois non dû (décision 7) : l'échéance tombe dans un mois strictement
 * après le mois de `date_fin` d'un bail résilié — y compris archivé après
 * sa résiliation (BauxService.archive() n'archive qu'un bail brouillon ou
 * résilié, et un brouillon n'a jamais d'échéance). La quittance d'un tel
 * mois est refusée.
 */
export function estEcheanceMoisNonDu(dateEcheance: string, bail: BailPourQuittance): boolean {
  if ((bail.statut !== "resilie" && bail.statut !== "archive") || bail.dateFin === null) {
    return false;
  }
  return classerEcheanceParRapportAFin(dateEcheance, bail.dateFin) === "apres_mois_fin";
}

function verifierDateIso(date: string, libelle: string): void {
  if (!estDateIsoValide(date)) {
    throw new Error(`${libelle} invalide : "${date}" (attendu AAAA-MM-JJ).`);
  }
}
