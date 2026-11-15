import { ajouterMois, estDateIsoValide, formaterDateCourteFr } from "../dates/calendrier";
import { calculerMontantRecuTotal, type VersementActif } from "../paiements/calculer-montant-recu-total";
import { calculerStatutPaiement, type StatutPaiement } from "../paiements/calculer-statut-paiement";
import { centimesVersMontant, montantEnCentimes } from "../paiements/montant";
import {
  calculerResteARembourser,
  deciderEcheanceApresFin,
  versementsActifsVerifies,
  type RemboursementSaisi,
  type StatutBail
} from "./cloture-financiere-resiliation";
import {
  calculerDateEcheanceRecurrente,
  calculerDecompositionEcheanceEntree,
  calculerDecompositionEcheanceFin,
  calculerMontantEcheanceLoyer,
  type DecompositionEcheanceEntree
} from "./echeances";

// Préavis (résiliation, conception 2 « vrai préavis », décisions de Jimmy
// du 2026-11-15 — tmp/decisions-preavis.md, reportées dans docs/backlog.md
// au commit de documentation). Fonctions pures : le backend lit les données,
// appelle ces fonctions et décide seul des écritures, sous le verrou du bail.
//
// Textes (loi n° 89-462, art. 15 pour le vide, art. 25-8 pour le meublé,
// versions en vigueur depuis la loi n° 2023-668) : Briky PROPOSE une durée
// et une date de fin, ne contrôle pas la validité du congé, et ne tranche
// aucun point juridique ouvert (dernier jour du préavis, LRAR non retirée…).
//
// Montants : chaînes décimales en entrée et en sortie, calculés en centimes
// entiers. Dates : AAAA-MM-JJ, vérifiées (erreur sinon).

export type TypeBail = "vide" | "meuble";
export type AuteurPreavis = "locataire" | "bailleur";

/**
 * Motifs de préavis réduit à un mois (bail vide, congé du locataire, art. 15
 * I, motifs que le locataire précise et justifie dans sa lettre).
 */
export const MOTIFS_PREAVIS_REDUIT = [
  "zone_tendue",
  "premier_emploi",
  "mutation",
  "perte_emploi",
  "nouvel_emploi_apres_perte",
  "sante",
  "violences",
  "rsa_aah",
  "logement_social"
] as const;
export type MotifPreavisReduit = (typeof MOTIFS_PREAVIS_REDUIT)[number];

/**
 * Durée PROPOSÉE (en mois), toujours modifiable par Jimmy (décision 1) :
 * vide — locataire 3 mois, ou 1 mois avec un motif de préavis réduit ;
 * bailleur 6 mois. Meublé — locataire 1 mois ; bailleur 3 mois. Un motif
 * n'a de sens que pour un congé du locataire sur un bail vide : erreur
 * sinon.
 */
export function dureePreavisProposee(
  typeBail: TypeBail,
  auteur: AuteurPreavis,
  motifReduit: MotifPreavisReduit | null = null
): number {
  if (motifReduit !== null && !(typeBail === "vide" && auteur === "locataire")) {
    throw new Error("Un motif de préavis réduit ne vaut que pour un congé du locataire sur un bail vide.");
  }
  if (typeBail === "vide") {
    if (auteur === "bailleur") {
      return 6;
    }
    return motifReduit === null ? 3 : 1;
  }
  return auteur === "bailleur" ? 3 : 1;
}

/**
 * Date de fin PROPOSÉE, à confirmer ou corriger par Jimmy (décision 1) :
 * date de réception + durée, au même quantième (ajouterMois), ramenée au
 * dernier jour du mois quand ce quantième n'existe pas (31/01 + 1 mois →
 * 28/02, ou 29/02 une année bissextile). Ce n'est PAS une date certaine : le
 * dernier jour exact du préavis (le 14 ou le 15 pour une réception le 15, la
 * réception un 31) est une question ouverte pour l'ADIL — l'interface la
 * présente comme proposée.
 */
export function dateFinPreavisProposee(dateReception: string, dureeMois: number): string {
  verifierDateIso(dateReception, "date de réception");
  verifierDuree(dureeMois);
  return ajouterMois(dateReception, dureeMois);
}

export interface DeclarationPreavis {
  typeBail: TypeBail;
  auteur: AuteurPreavis;
  motifReduit: MotifPreavisReduit | null;
  dureeMois: number;
  dateReception: string;
  /** Date de fin confirmée (ou corrigée) par Jimmy. */
  dateFin: string;
  /** Date de début du bail. */
  dateDebutBail: string;
}

/**
 * Cohérence d'une déclaration de préavis (décision 1) : liste des problèmes,
 * vide si la déclaration est cohérente. La durée et la date de fin restent
 * libres (proposées, modifiables) ; seules les incohérences sont refusées.
 * Aucun contrôle de validité juridique du congé (décision 5).
 */
export function validerDeclarationPreavis(declaration: DeclarationPreavis): string[] {
  const problemes: string[] = [];
  const dateReceptionValide = estDateIsoValide(declaration.dateReception);
  const dateFinValide = estDateIsoValide(declaration.dateFin);
  if (!dateReceptionValide) {
    problemes.push("La date de réception du congé doit être une date valide (AAAA-MM-JJ).");
  }
  if (!dateFinValide) {
    problemes.push("La date de fin du préavis doit être une date valide (AAAA-MM-JJ).");
  }
  if (!Number.isInteger(declaration.dureeMois) || declaration.dureeMois < 1 || declaration.dureeMois > 6) {
    problemes.push("La durée du préavis doit être un nombre entier de mois, de 1 à 6.");
  }
  if (declaration.motifReduit !== null && !(declaration.typeBail === "vide" && declaration.auteur === "locataire")) {
    problemes.push("Un motif de préavis réduit ne vaut que pour un congé du locataire sur un bail vide.");
  }
  if (dateReceptionValide && dateFinValide && declaration.dateFin < declaration.dateReception) {
    problemes.push("La date de fin du préavis ne peut pas précéder la date de réception du congé.");
  }
  if (dateReceptionValide && estDateIsoValide(declaration.dateDebutBail) && declaration.dateReception < declaration.dateDebutBail) {
    problemes.push("La date de réception du congé ne peut pas précéder la date de début du bail.");
  }
  return problemes;
}

/**
 * Décision 10 : un bail en préavis ne se résilie pas après la fin du
 * préavis — au-delà, l'occupation relève d'une indemnité d'occupation, à
 * gérer à part. À la date de fin du préavis ou avant : autorisé (avant =
 * relocation anticipée). null si la date est acceptée, ou si le bail n'a pas
 * de préavis (`finPreavis` null).
 */
export function refusDateFinResiliationApresPreavis(dateFin: string, finPreavis: string | null): string | null {
  if (finPreavis === null) {
    return null;
  }
  verifierDateIso(dateFin, "date de fin");
  verifierDateIso(finPreavis, "date de fin du préavis");
  if (dateFin <= finPreavis) {
    return null;
  }
  return `Résiliez au plus tard à la date de fin du préavis (${formaterDateCourteFr(finPreavis)}) : l'occupation au-delà relève d'une indemnité d'occupation, à gérer à part.`;
}

export interface BailGenerationEcheance {
  statut: StatutBail;
  loyerMensuel: string | null;
  provisionsCharges: string | null;
  dateDebut: string;
  dateFin: string | null;
  jourEcheance: number | null;
}

export type EcheanceRecurrente =
  | { type: "aucune" }
  | ({ type: "pleine" | "prorata"; dateEcheance: string } & DecompositionEcheanceEntree);

/**
 * Échéance de loyer que le job quotidien doit générer pour le mois de
 * `dateReference` (si aucune n'existe déjà ce mois-là — contrôle laissé au
 * job, qui le fait sous le verrou du bail) :
 * - bail ni actif ni en préavis, loyer ou jour d'échéance absent, ou mois
 *   antérieur au mois de date_debut : aucune ;
 * - bail en PRÉAVIS avec une date de fin (décisions 2, 3 et 8) : pleine
 *   avant le mois de fin, au prorata le mois de fin
 *   (calculerDecompositionEcheanceFin, même règle que la résiliation),
 *   aucune après — quel que soit l'auteur du congé (congé du bailleur : la
 *   date de fin est une limite, le départ réel passe par la résiliation) ;
 * - bail ACTIF : pleine, même s'il porte une date de fin (décision 8 :
 *   comportement actuel inchangé).
 */
export function echeanceRecurrenteAGenerer(bail: BailGenerationEcheance, dateReference: string): EcheanceRecurrente {
  verifierDateIso(dateReference, "date de référence");
  verifierDateIso(bail.dateDebut, "date de début");
  if (bail.statut !== "actif" && bail.statut !== "preavis") {
    return { type: "aucune" };
  }
  if (!bail.loyerMensuel || !bail.jourEcheance) {
    return { type: "aucune" };
  }
  const moisReference = moisDe(dateReference);
  if (moisReference < moisDe(bail.dateDebut)) {
    return { type: "aucune" };
  }
  const dateEcheance = calculerDateEcheanceRecurrente(dateReference, bail.jourEcheance);
  if (bail.statut === "preavis") {
    // Un bail en préavis a toujours une date de fin (posée par la
    // déclaration) : son absence est une incohérence, jamais un mois plein.
    if (bail.dateFin === null) {
      throw new Error("Bail en préavis sans date de fin.");
    }
    verifierDateIso(bail.dateFin, "date de fin");
    const moisFin = moisDe(bail.dateFin);
    if (moisReference > moisFin) {
      return { type: "aucune" };
    }
    if (moisReference === moisFin) {
      return {
        type: "prorata",
        dateEcheance,
        ...calculerDecompositionEcheanceFin(bail.loyerMensuel, bail.provisionsCharges, bail.dateDebut, bail.dateFin)
      };
    }
  }
  return { type: "pleine", dateEcheance, ...decompositionPleine(bail.loyerMensuel, bail.provisionsCharges) };
}

export interface BailRealignement {
  loyerMensuel: string;
  provisionsCharges: string | null;
  dateDebut: string;
  jourEcheance: number;
}

/** Échéance de loyer NON archivée du bail, avec ses versements et remboursements. */
export interface EcheanceARealigner {
  id: string;
  dateEcheance: string;
  montant: string;
  loyerHorsCharges: string | null;
  charges: string | null;
  statut: StatutPaiement;
  versements: readonly VersementActif[];
  remboursements: readonly RemboursementSaisi[];
}

export interface ParametresRealignement {
  bail: BailRealignement;
  /** Date de fin du préavis avant l'action ; null pour une déclaration. */
  ancienneFin: string | null;
  /** Date de fin après l'action ; null pour une annulation. */
  nouvelleFin: string | null;
  /** Échéances de loyer NON archivées du bail (les archivées n'existent plus pour le calcul). */
  echeances: readonly EcheanceARealigner[];
  /** Date du jour (Paris) : borne des mois créés. */
  dateReference: string;
}

export interface MiseAJourEcheance extends DecompositionEcheanceEntree {
  paiementId: string;
  statut: StatutPaiement;
}

export interface EcheanceConserveePreavis {
  paiementId: string;
  dateEcheance: string;
  montant: string;
  tropPercu: string;
  resteARembourser: string;
}

export interface EcheanceACreer extends DecompositionEcheanceEntree {
  dateEcheance: string;
}

/**
 * Refus métier du réalignement (le backend le traduit en 409, sans rien
 * écrire) — distinct d'une erreur de programmation ou d'une donnée invalide
 * (date mal formée, versement négatif), qui reste une erreur ordinaire.
 */
export class RefusRealignement extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusRealignement";
  }
}

export interface PlanRealignement {
  miseAJour: MiseAJourEcheance[];
  /** Ids des échéances à archiver (aucun versement actif). */
  archivages: string[];
  /** Échéances d'un mois après la fin gardées (au moins un versement actif). */
  conservations: EcheanceConserveePreavis[];
  creations: EcheanceACreer[];
  /** Trop-perçu sur l'échéance du nouveau mois de fin (null si aucun). */
  tropPercuMoisFin: { paiementId: string; tropPercu: string; resteARembourser: string } | null;
}

/**
 * Réalignement des échéances de loyer quand la date de fin d'un préavis est
 * posée, changée ou retirée (décisions 7 à 9 et 13) :
 * - DÉCLARATION (ancienneFin null) et date AVANCÉE : mêmes règles que la
 *   résiliation (conception 1) sur la nouvelle fin — mois de fin recalculé
 *   au prorata s'il est impayé ou partiel, laissé tel quel s'il est payé
 *   (trop-perçu signalé) ; mois suivants archivés sans versement actif,
 *   sinon gardés avec tout le reçu en trop-perçu ;
 * - date RECULÉE et ANNULATION (nouvelleFin null) : chaque mois redevenu dû
 *   en entier (de l'ancien mois de fin au nouveau mois de fin exclu, sans
 *   borne pour une annulation — y compris un mois gardé lors d'une fin
 *   avancée antérieure) est recalculé, et le nouveau mois de fin remis au
 *   nouveau prorata, MÊME PAYÉS (décision 9 : ils repassent alors
 *   partiels) ; les mois manquants à partir de l'ancien mois de fin sont
 *   créés jusqu'au mois courant (pleins, le nouveau mois de fin au
 *   prorata) ; un mois dont l'échéance a été archivée compte comme
 *   manquant, et l'échéance archivée n'est jamais désarchivée ;
 * - une échéance PAYÉE n'est jamais remontée hors recul ou annulation (même
 *   règle que la résiliation : trop-perçu signalé, montant inchangé).
 * Déclaration avec un mois de fin passé et sans échéance : rien n'est créé
 * — le job ne génère que le mois courant ; c'est la résiliation (Cas B) qui
 * créera ce mois au prorata.
 * Aucune échéance d'un mois antérieur à l'ancien mois de fin n'est touchée
 * (une révision de loyer a pu en changer le montant légitimement).
 * Erreur si deux échéances non archivées tombent dans un mois recalculé ;
 * plusieurs échéances après la fin sont traitées une à une.
 */
export function planRealignementEcheances(parametres: ParametresRealignement): PlanRealignement {
  const { bail, ancienneFin, nouvelleFin, echeances, dateReference } = parametres;
  verifierDateIso(bail.dateDebut, "date de début");
  verifierDateIso(dateReference, "date de référence");
  if (ancienneFin === null && nouvelleFin === null) {
    throw new Error("Réalignement sans date de fin, ni ancienne ni nouvelle.");
  }
  for (const [date, libelle] of [
    [ancienneFin, "ancienne date de fin"],
    [nouvelleFin, "nouvelle date de fin"]
  ] as const) {
    if (date !== null) {
      verifierDateIso(date, libelle);
      if (date < bail.dateDebut) {
        throw new Error(`La ${libelle} (${date}) précède la date de début du bail (${bail.dateDebut}).`);
      }
    }
  }

  const parMois = new Map<string, EcheanceARealigner[]>();
  for (const echeance of echeances) {
    verifierDateIso(echeance.dateEcheance, "date d'échéance");
    const mois = moisDe(echeance.dateEcheance);
    parMois.set(mois, [...(parMois.get(mois) ?? []), echeance]);
  }
  const moisTries = [...parMois.keys()].sort();
  // Mois recalculés (fin ou remis pleins) : une seule échéance non archivée
  // attendue, sinon on ne sait pas laquelle corriger.
  const uniqueDuMois = (mois: string): EcheanceARealigner | undefined => {
    const liste = parMois.get(mois) ?? [];
    if (liste.length > 1) {
      throw new RefusRealignement(
        `Plusieurs échéances de loyer (${liste.length}) couvrent le mois ${mois} : gardez-en une seule (archivez les autres depuis Finances), puis recommencez.`
      );
    }
    return liste[0];
  };

  const plan: PlanRealignement = {
    miseAJour: [],
    archivages: [],
    conservations: [],
    creations: [],
    tropPercuMoisFin: null
  };
  const moisAncienneFin = ancienneFin === null ? null : moisDe(ancienneFin);
  const moisNouvelleFin = nouvelleFin === null ? null : moisDe(nouvelleFin);
  // Date reculée (ou annulation, recul « à l'infini ») : seuls cas où une
  // échéance PAYÉE peut être remontée (décision 9).
  const recul = ancienneFin !== null && (nouvelleFin === null || nouvelleFin > ancienneFin);

  // 1. Nouveau mois de fin, puis mois suivants.
  if (nouvelleFin !== null && moisNouvelleFin !== null) {
    const cible = calculerDecompositionEcheanceFin(bail.loyerMensuel, bail.provisionsCharges, bail.dateDebut, nouvelleFin);
    const echeanceFin = uniqueDuMois(moisNouvelleFin);
    if (echeanceFin) {
      const recu = calculerMontantRecuTotal(versementsActifsVerifies(echeanceFin.versements));
      const centimesCible = montantEnCentimes(cible.montant);
      // Payée : laissée telle quelle (règle de la résiliation, trop-perçu
      // signalé), SAUF hausse due à une date reculée (décision 9).
      const hausseParRecul = recul && centimesCible > montantEnCentimes(echeanceFin.montant);
      const laisserTelleQuelle = echeanceFin.statut === "paye" && !hausseParRecul;
      if (!laisserTelleQuelle && !memeDecomposition(echeanceFin, cible)) {
        if (hausseParRecul) {
          refuserSiDejaRemboursee(echeanceFin);
        }
        plan.miseAJour.push({ paiementId: echeanceFin.id, ...cible, statut: calculerStatutPaiement(cible.montant, recu) });
      }
      const tropPercu = centimesVersMontant(Math.max(0, montantEnCentimes(recu) - centimesCible));
      if (montantEnCentimes(tropPercu) > 0) {
        plan.tropPercuMoisFin = {
          paiementId: echeanceFin.id,
          tropPercu,
          resteARembourser: calculerResteARembourser(tropPercu, echeanceFin.remboursements)
        };
      }
    }

    // Mois après la fin : chaque échéance, même s'il y en a plusieurs dans
    // un mois (comme resilier()), archivée sans versement actif, gardée
    // sinon avec tout le reçu en trop-perçu.
    for (const mois of moisTries) {
      if (mois <= moisNouvelleFin) {
        continue;
      }
      for (const echeance of parMois.get(mois) ?? []) {
        const decision = deciderEcheanceApresFin(echeance.versements);
        if (decision.decision === "archiver") {
          plan.archivages.push(echeance.id);
        } else {
          plan.conservations.push({
            paiementId: echeance.id,
            dateEcheance: echeance.dateEcheance,
            montant: echeance.montant,
            tropPercu: decision.tropPercu,
            resteARembourser: calculerResteARembourser(decision.tropPercu, echeance.remboursements)
          });
        }
      }
    }
  }

  // 2. Date reculée ou annulation : tout mois redevenu dû en entier — de
  //    l'ancien mois de fin jusqu'au nouveau mois de fin exclu (sans borne
  //    pour une annulation) — est remis à son montant attendu MÊME payé
  //    (décision 9), y compris un mois gardé lors d'une fin avancée
  //    antérieure ; les mois manquants jusqu'au mois courant sont créés,
  //    l'ancien mois de fin compris s'il manque.
  if (recul && moisAncienneFin !== null) {
    const estRedevenuDu = (mois: string) =>
      mois >= moisAncienneFin && (moisNouvelleFin === null || mois < moisNouvelleFin);
    for (const mois of moisTries) {
      if (!estRedevenuDu(mois)) {
        continue;
      }
      const echeance = uniqueDuMois(mois);
      if (!echeance) {
        continue;
      }
      const cible = decompositionAttendueMoisPlein(bail, mois);
      if (!memeDecomposition(echeance, cible)) {
        refuserSiDejaRemboursee(echeance);
        const recu = calculerMontantRecuTotal(versementsActifsVerifies(echeance.versements));
        plan.miseAJour.push({ paiementId: echeance.id, ...cible, statut: calculerStatutPaiement(cible.montant, recu) });
      }
    }

    const moisCourant = moisDe(dateReference);
    const dernierMoisACreer =
      moisNouvelleFin !== null && moisNouvelleFin < moisCourant ? moisNouvelleFin : moisCourant;
    for (let mois = moisAncienneFin; mois <= dernierMoisACreer; mois = moisSuivant(mois)) {
      if (parMois.has(mois)) {
        continue;
      }
      const decomposition =
        nouvelleFin !== null && mois === moisNouvelleFin
          ? calculerDecompositionEcheanceFin(bail.loyerMensuel, bail.provisionsCharges, bail.dateDebut, nouvelleFin)
          : decompositionAttendueMoisPlein(bail, mois);
      const dateEcheance =
        mois === moisDe(bail.dateDebut) ? bail.dateDebut : calculerDateEcheanceRecurrente(`${mois}-01`, bail.jourEcheance);
      plan.creations.push({ dateEcheance, ...decomposition });
    }
  }

  return plan;
}

// Remonter le montant d'une échéance dont un trop-perçu a déjà été
// remboursé fausserait son statut et le reste dû (le reçu ne compte que les
// versements, pas les remboursements). La règle (reçu net ou non) n'est pas
// tranchée : refus en attendant la décision de Jimmy (revue
// financial-logic-reviewer du commit 3a).
function refuserSiDejaRemboursee(echeance: EcheanceARealigner): void {
  if (echeance.remboursements.some((remboursement) => remboursement.archivedAt === null)) {
    throw new RefusRealignement(
      `Un trop-perçu de l'échéance du ${formaterDateCourteFr(echeance.dateEcheance)} a déjà été remboursé : corrigez d'abord ce remboursement, puis recommencez.`
    );
  }
}

function decompositionPleine(loyerMensuel: string, provisionsCharges: string | null): DecompositionEcheanceEntree {
  return {
    montant: calculerMontantEcheanceLoyer(loyerMensuel, provisionsCharges),
    loyerHorsCharges: centimesVersMontant(montantEnCentimes(loyerMensuel)),
    charges: centimesVersMontant(provisionsCharges ? montantEnCentimes(provisionsCharges) : 0)
  };
}

// Montant attendu d'un mois qui n'est plus le mois de fin : plein, sauf le
// mois de date_debut, proratisé depuis l'entrée (même règle qu'activer()).
function decompositionAttendueMoisPlein(bail: BailRealignement, mois: string): DecompositionEcheanceEntree {
  if (mois === moisDe(bail.dateDebut)) {
    return calculerDecompositionEcheanceEntree(bail.loyerMensuel, bail.provisionsCharges, bail.dateDebut);
  }
  return decompositionPleine(bail.loyerMensuel, bail.provisionsCharges);
}

function memeDecomposition(echeance: EcheanceARealigner, cible: DecompositionEcheanceEntree): boolean {
  return (
    montantEnCentimes(echeance.montant) === montantEnCentimes(cible.montant) &&
    echeance.loyerHorsCharges !== null &&
    echeance.charges !== null &&
    montantEnCentimes(echeance.loyerHorsCharges) === montantEnCentimes(cible.loyerHorsCharges) &&
    montantEnCentimes(echeance.charges) === montantEnCentimes(cible.charges)
  );
}

function moisDe(date: string): string {
  return date.slice(0, 7);
}

function moisSuivant(mois: string): string {
  return ajouterMois(`${mois}-01`, 1).slice(0, 7);
}

function verifierDuree(dureeMois: number): void {
  if (!Number.isInteger(dureeMois) || dureeMois < 1 || dureeMois > 6) {
    throw new Error(`Durée de préavis invalide : ${dureeMois} (attendu un entier de 1 à 6 mois).`);
  }
}

function verifierDateIso(date: string, libelle: string): void {
  if (!estDateIsoValide(date)) {
    throw new Error(`${libelle} invalide : "${date}" (attendu AAAA-MM-JJ).`);
  }
}
