import { ajouterJours, formaterDateCourteFr, montantEnCentimes } from "core";
import type {
  AuteurPreavis,
  BailTypeBail,
  ModeRemisePreavis,
  MotifPreavisReduit,
  RealignementPreavis
} from "../locataires/api";
import type { TexteConfirmation } from "./textes-confirmation";

// Textes du préavis (résiliation, conception 2 « vrai préavis », commit 4
// desktop). Chaque phrase décrit ce que fait réellement le backend :
// - PreavisService (apps/backend/src/baux/preavis.service.ts) : déclarer
//   (bail actif → « preavis », baux.date_fin = date confirmée), corriger
//   (ligne archivée « corrige » + nouvelle ligne), annuler (jusqu'à la date
//   de fin incluse ; bail « actif », date de fin d'origine rétablie) ;
// - planRealignementEcheances (packages/core/src/baux/preavis.ts) : mois de
//   fin ramené au prorata s'il n'est pas entièrement payé, mois suivants
//   archivés sans versement actif ou gardés avec trop-perçu ; en cas de
//   recul ou d'annulation, mois redevenus dus remis pleins même payés,
//   mois manquants créés jusqu'au mois en cours, archivés jamais restaurés,
//   refus si un trop-perçu de ces mois a déjà été remboursé ;
// - le job (echeanceRecurrenteAGenerer) : pour un bail en préavis, mois de
//   fin au prorata, rien après.

export const LIBELLES_AUTEUR_PREAVIS: Record<AuteurPreavis, string> = {
  locataire: "Congé du locataire",
  bailleur: "Congé du bailleur"
};

export const LIBELLES_MODE_REMISE_PREAVIS: Record<ModeRemisePreavis, string> = {
  lrar: "Lettre recommandée avec avis de réception",
  commissaire_justice: "Acte de commissaire de justice",
  main_propre: "Remise en main propre (récépissé ou émargement)"
};

// Motifs du préavis réduit à un mois (loi n° 89-462, art. 15 I, 1° à 5°).
export const LIBELLES_MOTIF_PREAVIS_REDUIT: Record<MotifPreavisReduit, string> = {
  zone_tendue: "Logement situé en zone tendue",
  premier_emploi: "Obtention d'un premier emploi",
  mutation: "Mutation professionnelle",
  perte_emploi: "Perte d'emploi",
  nouvel_emploi_apres_perte: "Nouvel emploi consécutif à une perte d'emploi",
  sante: "État de santé justifiant un changement de domicile",
  violences: "Violences (ordonnance de protection ou condamnation)",
  rsa_aah: "Bénéficiaire du RSA ou de l'AAH",
  logement_social: "Attribution d'un logement social"
};

export function libelleDureePreavis(dureeMois: number): string {
  return dureeMois === 1 ? "1 mois" : `${dureeMois} mois`;
}

// La date proposée n'est jamais présentée comme certaine (décision 1 :
// dernier jour exact du préavis non tranché, question ADIL).
export function texteDateFinProposee(dateProposee: string): string {
  return `Date de fin proposée : ${formaterDateCourteFr(dateProposee)} (réception + durée), à confirmer — selon l'interprétation, le préavis peut s'achever la veille, le ${formaterDateCourteFr(ajouterJours(dateProposee, -1))}.`;
}

// Rappel sous le formulaire (loi n° 89-462, art. 15 pour le vide, art. 25-8
// pour le meublé, synthèse de Jimmy du 2026-11-15).
export function texteRappelLoyerPreavis(auteur: AuteurPreavis, typeBail: BailTypeBail): string {
  const article = typeBail === "meuble" ? "art. 25-8" : "art. 15";
  return auteur === "locataire"
    ? `Congé du locataire : le loyer et les charges restent dus jusqu'à la fin du préavis, même s'il part avant, sauf si le logement est reloué plus tôt avec votre accord (loi du 6 juillet 1989, ${article}).`
    : `Congé du bailleur : le loyer et les charges ne sont dus que pour le temps où le locataire occupe réellement le logement ; résiliez le bail à son départ réel (loi du 6 juillet 1989, ${article}).`;
}

const PHRASE_RECALAGE_FIN =
  "Les échéances de loyer déjà créées sont recalées : celle du mois de fin est ramenée au prorata si elle n'est pas entièrement payée (sinon, la somme reçue en trop est signalée) ; celles des mois suivants sont archivées si elles n'ont reçu aucun versement, gardées sinon avec la somme reçue signalée comme trop-perçu.";
const PHRASE_RECALAGE_RECUL =
  "Les mois redevenus dus sont remis à leur montant plein, même déjà payés (ils repassent alors en paiement partiel), et les mois manquants jusqu'au mois en cours sont créés ; les échéances archivées ne sont pas restaurées. L'action est refusée si un trop-perçu de ces mois a déjà été remboursé.";

export function texteDeclarationPreavis({
  numeroAppartement,
  auteur,
  dateFin
}: {
  numeroAppartement: string;
  auteur: AuteurPreavis;
  dateFin: string;
}): TexteConfirmation {
  return {
    titre: "Enregistrer le préavis ?",
    objet: `Logement n° ${numeroAppartement} — ${LIBELLES_AUTEUR_PREAVIS[auteur].toLowerCase()}`,
    explication: [
      `Le bail passera en préavis, avec une fin au ${formaterDateCourteFr(dateFin)}.`,
      "Les loyers seront générés jusqu'au mois de fin, ce dernier au prorata des jours occupés, puis plus rien.",
      PHRASE_RECALAGE_FIN,
      "Le préavis pourra être corrigé, ou annulé jusqu'à sa date de fin."
    ].join(" "),
    libelleConfirmer: "Enregistrer le préavis",
    libelleEnCours: "Enregistrement…",
    messageRepli: "Impossible d'enregistrer le préavis."
  };
}

export function texteCorrectionPreavis({
  numeroAppartement,
  ancienneFin,
  nouvelleFin
}: {
  numeroAppartement: string;
  ancienneFin: string;
  nouvelleFin: string;
}): TexteConfirmation {
  const phrases: string[] = [];
  if (nouvelleFin === ancienneFin) {
    phrases.push(
      `La date de fin reste le ${formaterDateCourteFr(nouvelleFin)} : seules les autres informations du préavis changent, aucune échéance n'est modifiée.`
    );
  } else if (nouvelleFin < ancienneFin) {
    phrases.push(
      `La fin du préavis sera avancée du ${formaterDateCourteFr(ancienneFin)} au ${formaterDateCourteFr(nouvelleFin)}.`,
      PHRASE_RECALAGE_FIN
    );
  } else {
    phrases.push(
      `La fin du préavis sera reculée du ${formaterDateCourteFr(ancienneFin)} au ${formaterDateCourteFr(nouvelleFin)}.`,
      PHRASE_RECALAGE_RECUL
    );
  }
  phrases.push("L'ancienne version du préavis reste dans l'historique.");
  return {
    titre: "Corriger le préavis ?",
    objet: `Logement n° ${numeroAppartement}`,
    explication: phrases.join(" "),
    libelleConfirmer: "Corriger le préavis",
    libelleEnCours: "Correction…",
    messageRepli: "Impossible de corriger le préavis."
  };
}

export function texteAnnulationPreavis({
  numeroAppartement,
  dateFinPreavis,
  dateFinBailAvant
}: {
  numeroAppartement: string;
  dateFinPreavis: string;
  dateFinBailAvant: string | null;
}): TexteConfirmation {
  return {
    titre: "Annuler le préavis ?",
    objet: `Logement n° ${numeroAppartement}, préavis jusqu'au ${formaterDateCourteFr(dateFinPreavis)}`,
    explication: [
      dateFinBailAvant
        ? `Le bail redeviendra actif, avec sa date de fin d'origine (${formaterDateCourteFr(dateFinBailAvant)}).`
        : "Le bail redeviendra actif, sans date de fin.",
      "Les loyers seront de nouveau générés chaque mois en entier.",
      PHRASE_RECALAGE_RECUL,
      "Le préavis annulé reste dans l'historique."
    ].join(" "),
    libelleConfirmer: "Annuler le préavis",
    libelleEnCours: "Annulation…",
    messageRepli: "Impossible d'annuler le préavis."
  };
}

// Résumé après une action, d'après la réponse de l'API : totaux de CETTE
// action seulement. null : aucune échéance touchée.
export function texteResultatPreavis(realignement: RealignementPreavis): string | null {
  const compte = (n: number, singulier: string, pluriel: string) => (n === 1 ? `1 ${singulier}` : `${n} ${pluriel}`);
  const elements: string[] = [];
  if (realignement.echeancesRecalculees.length > 0) {
    elements.push(compte(realignement.echeancesRecalculees.length, "échéance recalculée", "échéances recalculées"));
  }
  if (realignement.echeancesArchivees.length > 0) {
    elements.push(compte(realignement.echeancesArchivees.length, "échéance archivée", "échéances archivées"));
  }
  if (realignement.echeancesConservees.length > 0) {
    elements.push(compte(realignement.echeancesConservees.length, "échéance gardée (déjà payée)", "échéances gardées (déjà payées)"));
  }
  if (realignement.echeancesCreees.length > 0) {
    elements.push(compte(realignement.echeancesCreees.length, "échéance créée", "échéances créées"));
  }
  const phrases: string[] = [];
  if (elements.length > 0) {
    phrases.push(`Pour cette action : ${elements.join(", ")}.`);
  }
  if (montantEnCentimes(realignement.tropPercuTotal) > 0) {
    phrases.push(
      `Trop-perçu signalé pour cette action : ${euros(realignement.tropPercuTotal)} ; reste à rembourser : ${euros(realignement.resteARembourserTotal)}, visible dans « Remboursements en attente ».`
    );
  }
  return phrases.length > 0 ? phrases.join(" ") : null;
}

// Avertissement non bloquant : préavis écoulé sans résiliation.
export function avertissementPreavisEcoule(dateFin: string, aujourdHui: string): string | null {
  return aujourdHui > dateFin
    ? `Préavis écoulé depuis le ${formaterDateCourteFr(dateFin)} : pensez à résilier le bail (au plus tard à cette date).`
    : null;
}

// Date maximale de la résiliation d'un bail : aujourd'hui, et pour un bail
// en préavis la fin du préavis si elle est plus tôt (décision 10).
export function dateMaxResiliation(aujourdHui: string, finPreavis: string | null): string {
  return finPreavis !== null && finPreavis < aujourdHui ? finPreavis : aujourdHui;
}

function euros(montant: string): string {
  return `${montant.replace(".", ",")} €`;
}
