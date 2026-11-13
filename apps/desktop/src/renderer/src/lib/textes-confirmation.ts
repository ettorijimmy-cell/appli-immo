import { formaterDateCourteFr } from "core";
import { MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO, messageRepliArchivage } from "../documents/archivage-document";
import type { DocumentMetier } from "../documents/api";
import type { Garant, Locataire } from "../locataires/api";
import type { Appartement, Equipement, EquipementType } from "../patrimoine/api";
import { SINISTRE_STATUT_LABELS, SINISTRE_TYPE_LABELS, type Sinistre } from "../sinistres/api";

// Textes des confirmations d'archivage et de retrait (chantier archivage,
// décisions du 2026-11-12, tmp/decisions-archivage.md points 5 à 7) :
// une phrase claire de ce qui va se passer, puis si c'est réversible.
// Passés tels quels à ConfirmationActionModal.
export interface TexteConfirmation {
  titre: string;
  objet?: string;
  explication: string;
  libelleConfirmer: string;
  libelleEnCours: string;
  messageRepli: string;
}

// Formulation commune (décision 6) : aucun désarchivage n'existe encore.
export const PHRASE_ARCHIVAGE_IRREVERSIBLE = "L'archivage ne peut pas être annulé depuis l'application.";

export function texteArchivageLocataire(locataire: Pick<Locataire, "prenom" | "nom">): TexteConfirmation {
  return {
    titre: "Archiver ce locataire ?",
    explication: `${locataire.prenom} ${locataire.nom} n'apparaîtra plus dans la liste des locataires. Ses baux, paiements et documents sont conservés. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Archiver le locataire",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver ce locataire."
  };
}

export function texteArchivageAppartement(appartement: Pick<Appartement, "numero">): TexteConfirmation {
  return {
    titre: `Archiver l'appartement n° ${appartement.numero} ?`,
    explication: `L'appartement ne sera plus compté dans le tableau de bord, la fiscalité ni la répartition des charges. Son historique est conservé. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Archiver l'appartement",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver cet appartement."
  };
}

const LIBELLES_EQUIPEMENT: Record<EquipementType, string> = {
  chaudiere: "La chaudière",
  ballon_eau_chaude: "Le ballon d'eau chaude",
  autre: "L'équipement"
};

export function texteArchivageEquipement(equipement: Pick<Equipement, "type">): TexteConfirmation {
  return {
    titre: "Archiver l'équipement ?",
    explication: `${LIBELLES_EQUIPEMENT[equipement.type]} n'apparaîtra plus dans la liste des équipements. Son historique est conservé. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Archiver l'équipement",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver cet équipement."
  };
}

export function texteArchivageSinistre(sinistre: Pick<Sinistre, "type" | "statut">): TexteConfirmation {
  const type = SINISTRE_TYPE_LABELS[sinistre.type].toLowerCase();
  const statut = SINISTRE_STATUT_LABELS[sinistre.statut].toLowerCase();
  return {
    titre: "Archiver ce sinistre ?",
    explication: `Le sinistre (${type}, statut ${statut}) sortira de la liste et son alerte de suivi sera close. Ses documents sont conservés. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Archiver le sinistre",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver ce sinistre."
  };
}

export function texteArchivageDocument(
  document: Pick<DocumentMetier, "nomFichier" | "categorie">
): TexteConfirmation {
  const photo = document.categorie === "photo";
  return {
    titre: photo ? "Archiver la photo ?" : "Archiver le document ?",
    objet: document.nomFichier,
    explication: `${
      photo
        ? MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO
        : "Le document sera archivé, pas supprimé. Il reste consultable dans les archives."
    } ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: photo ? "Archiver la photo" : "Archiver le document",
    libelleEnCours: "Archivage…",
    messageRepli: messageRepliArchivage(document)
  };
}

// Phrase d'engagement d'une caution personne physique (décision 5,
// précisée le 2026-11-13). Colocataire garanti ayant donné congé (art.
// 8-1, VI) : la date la plus proche entre la fin d'engagement et la fin
// « au plus tard » de la colocation, formulée « au plus tard ». Sans date
// connue (lecture en échec, durée indéterminée) : phrase sans date.
function phraseEngagementCaution(engagement: EngagementPourRetrait | null): string {
  const debut = "Le retrait dans Briky ne met pas fin à l'engagement de la caution";
  const dateFin = engagement?.dateFinEngagement ?? null;
  const auPlusTardColocation = engagement?.colocation?.auPlusTard ?? null;
  if (auPlusTardColocation !== null) {
    // Dates ISO AAAA-MM-JJ : l'ordre alphabétique est l'ordre chronologique.
    const plusProche = dateFin !== null && dateFin < auPlusTardColocation ? dateFin : auPlusTardColocation;
    return `${debut}, qui court au plus tard jusqu'au ${formaterDateCourteFr(plusProche)}.`;
  }
  return dateFin !== null ? `${debut}, qui court jusqu'au ${formaterDateCourteFr(dateFin)}.` : `${debut}.`;
}

// Ce que le retrait lit de GET /garants/:id/engagement (EngagementCaution).
export interface EngagementPourRetrait {
  dateFinEngagement: string | null;
  colocation: { auPlusTard: string } | null;
}

// Retrait autorisé (correction d'une erreur de saisie), mais il ne met pas
// fin à l'engagement de la caution (décision 5). `engagement` : la réponse
// de GET /garants/:id/engagement déjà lue avec la fiche, null si la lecture
// a échoué. Garantie Visale et ancien type « autre » : pas d'engagement de
// caution, pas de phrase.
export function texteRetraitGarant(
  garant: Pick<Garant, "nom" | "prenom" | "typeGarantie">,
  engagement: EngagementPourRetrait | null
): TexteConfirmation {
  const nom = garant.prenom ? `${garant.prenom} ${garant.nom}` : garant.nom;
  const phrases = [`${nom} n'apparaîtra plus sur ce bail ni dans le document de bail généré.`];
  if (garant.typeGarantie === "personne_physique") {
    phrases.push("Les déclarations de remise et l'acte de cautionnement sont conservés.");
    phrases.push(phraseEngagementCaution(engagement));
  } else {
    phrases.push("Ses documents sont conservés.");
  }
  phrases.push(PHRASE_ARCHIVAGE_IRREVERSIBLE);
  return {
    titre: `Retirer ${nom} du bail ?`,
    explication: phrases.join(" "),
    libelleConfirmer: "Retirer le garant",
    libelleEnCours: "Retrait…",
    messageRepli: "Impossible de retirer ce garant."
  };
}
