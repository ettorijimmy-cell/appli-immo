import { formaterDateCourteFr } from "core";
import { MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO, messageRepliArchivage } from "../documents/archivage-document";
import type { EvenementCalendrier } from "../calendrier/api";
import type { Candidat } from "../candidats/api";
import type { Contact } from "../contacts/api";
import type { RegleCategorisation } from "../depenses/api";
import type { DocumentMetier } from "../documents/api";
import type { Paiement, PaiementType, Versement } from "../finances/api";
import type { Garant, Locataire } from "../locataires/api";
import { libelleBien, type Appartement, type Bien, type Equipement, type EquipementType } from "../patrimoine/api";
import type { Sci } from "../scis/api";
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
    // Le message photo porte déjà la formulation commune (décision 13) :
    // jamais ajoutée une seconde fois ici.
    explication: photo
      ? MESSAGE_CONFIRMATION_ARCHIVAGE_PHOTO
      : `Le document sera archivé, pas supprimé. Il reste consultable dans les archives. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
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

// Résiliation du bail (commit 3 du chantier archivage). Chaque phrase
// décrit ce que fait réellement BauxService.resilier() (apps/backend/src/
// baux/baux.service.ts), sans rien promettre de plus :
// - statut « resilie », définitif (activer() n'accepte qu'un brouillon,
//   UpdateBailDto n'a pas de statut) ;
// - date de fin : celle saisie ; sans saisie, la date déjà enregistrée sur
//   le bail est conservée telle quelle, et rien n'est proratisé ;
// - avec une date : l'échéance de loyer du mois de fin est ajustée au
//   prorata des jours occupés si elle n'est pas entièrement payée (impayée
//   ou partielle), créée si elle manque ;
//   déjà payée, elle n'est pas modifiée et un trop-perçu est seulement
//   signalé ;
// - plus aucune échéance générée ensuite (le job mensuel ne traite que
//   les baux actifs ou en préavis), les échéances existantes restent dues ;
// - l'appartement repasse vacant seulement s'il était loué.
export function texteResiliationBail({
  numeroAppartement,
  dateDebut,
  dateFinEnregistree,
  dateFinSaisie
}: {
  numeroAppartement: string;
  dateDebut: string;
  // Date de fin déjà enregistrée sur le bail, null si aucune.
  dateFinEnregistree: string | null;
  // Date saisie à côté du bouton « Résilier le bail », "" si aucune.
  dateFinSaisie: string;
}): TexteConfirmation {
  const phrases: string[] = [];
  if (dateFinSaisie !== "") {
    phrases.push(
      `Le bail passera en statut résilié, avec une fin d'occupation au ${formaterDateCourteFr(dateFinSaisie)}.`,
      "Le loyer de ce mois sera ramené au prorata des jours occupés : l'échéance est ajustée si elle n'est pas entièrement payée, ou créée si elle n'existe pas ; une échéance déjà payée n'est pas modifiée. Un trop-perçu éventuel est signalé, jamais remboursé automatiquement."
    );
  } else {
    phrases.push(
      dateFinEnregistree
        ? `Le bail passera en statut résilié. Aucune date de fin n'est saisie : la date déjà enregistrée (${formaterDateCourteFr(dateFinEnregistree)}) est conservée et aucun loyer n'est proratisé.`
        : "Le bail passera en statut résilié. Aucune date de fin n'est saisie : le bail restera sans date de fin et aucun loyer n'est proratisé."
    );
  }
  phrases.push(
    "Plus aucune échéance de loyer ne sera générée ; celles déjà créées restent dues.",
    "L'appartement repassera vacant s'il était loué.",
    "Cette action est définitive : un bail résilié ne peut pas être réactivé."
  );
  return {
    titre: "Résilier le bail ?",
    objet: `Logement n° ${numeroAppartement}, bail du ${formaterDateCourteFr(dateDebut)}`,
    explication: phrases.join(" "),
    libelleConfirmer: "Résilier le bail",
    libelleEnCours: "Résiliation…",
    messageRepli: "Impossible de résilier le bail."
  };
}

// Commit 4+5 du chantier archivage : autres archivages. Chaque phrase
// renvoie à un comportement vérifié dans le code (tmp/reponse.md du
// 2026-11-13) ; aucune cascade n'existe pour la SCI ni pour le bien.

// SCI : masquée de la liste Patrimoine (ScisListView) et de l'écran
// Fiscalité, qui ne retient que les SCI « active » (FiscaliteView). Ni ses
// biens, ni ses appartements, ni ses baux ne sont archivés (ScisService
// .archive() n'écrit que la SCI).
export function texteArchivageSci(sci: Pick<Sci, "nom">): TexteConfirmation {
  return {
    titre: "Archiver la SCI ?",
    explication: `${sci.nom} sera masquée du patrimoine (visible avec « Afficher les archivés ») et n'apparaîtra plus dans l'écran Fiscalité. Ses biens, appartements et baux ne sont pas archivés. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Archiver la SCI",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver cette SCI."
  };
}

// Bien : masqué des listes. Aucune cascade (BienService.archive() n'écrit
// que le bien).
// - Bien d'une SCI : dans l'annexe 1, ses propres loyers et dépenses
//   restent comptés ; il ne reçoit plus de part des dépenses communes de
//   la SCI (FiscaliteService, biensActifsPourProrata).
// - Bien en nom propre : il n'est plus proposé dans l'écran Fiscalité
//   (FiscaliteView ne retient que les biens en nom propre « actif »).
export function texteArchivageBien(bien: Pick<Bien, "nom" | "adresse" | "proprietaireType">): TexteConfirmation {
  const fiscalite =
    bien.proprietaireType === "personne_physique"
      ? "Il ne sera plus proposé dans l'écran Fiscalité (déclaration 2044)."
      : "Dans la déclaration fiscale de la SCI, ses propres loyers et dépenses restent comptés, mais il ne reçoit plus de part des dépenses communes de la SCI.";
  return {
    titre: "Archiver le bien ?",
    explication: `${libelleBien(bien)} sera masqué de la liste (visible avec « Afficher les archivés »). ${fiscalite} Ses appartements et leurs baux ne sont pas archivés. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Archiver le bien",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver ce bien."
  };
}

const LIBELLES_TYPE_PAIEMENT: Record<PaiementType, string> = {
  loyer: "loyer",
  charges: "charges",
  depot_garantie: "dépôt de garantie"
};

// Paiement : PaiementsService.archive() archive aussi, dans la même
// transaction, tous ses versements actifs. Pour un loyer, ces versements
// sortent des revenus locatifs (TableauDeBordService.getRevenusLocatifs,
// repris par la fiscalité). `nbVersementsActifs` : null tant qu'il n'est
// pas connu (lecture en cours ou en échec) — phrase sans nombre.
export function texteArchivagePaiement(
  paiement: Pick<Paiement, "montant" | "dateEcheance" | "type">,
  nbVersementsActifs: number | null
): TexteConfirmation {
  const designation = `Le paiement de ${paiement.montant} € (${LIBELLES_TYPE_PAIEMENT[paiement.type]}, échéance du ${formaterDateCourteFr(paiement.dateEcheance)})`;
  const phrases: string[] = [];
  if (nbVersementsActifs === null) {
    phrases.push(`${designation} et ses versements éventuels seront archivés.`);
  } else if (nbVersementsActifs === 0) {
    phrases.push(`${designation} sera archivé ; aucun versement n'y est enregistré.`);
  } else {
    phrases.push(
      nbVersementsActifs === 1
        ? `${designation} et son versement seront archivés.`
        : `${designation} et ses ${nbVersementsActifs} versements seront archivés.`
    );
  }
  if (paiement.type === "loyer" && nbVersementsActifs !== 0) {
    phrases.push("Les sommes versées ne compteront plus dans les revenus locatifs (tableau de bord, fiscalité).");
  }
  phrases.push(
    nbVersementsActifs === 0
      ? "Il reste visible avec « Afficher les archivés »."
      : "Ils restent visibles avec « Afficher les archivés ».",
    PHRASE_ARCHIVAGE_IRREVERSIBLE
  );
  return {
    titre: "Archiver ce paiement ?",
    explication: phrases.join(" "),
    libelleConfirmer: "Archiver le paiement",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver ce paiement."
  };
}

// Versement : VersementsService.annuler() l'archive puis recalcule le
// statut du paiement depuis ses versements restants. Pour un loyer, il
// sort aussi des revenus locatifs.
export function texteAnnulationVersement(
  versement: Pick<Versement, "montant" | "dateVersement">,
  typePaiement: PaiementType
): TexteConfirmation {
  const revenus = typePaiement === "loyer" ? " ni dans les revenus locatifs" : "";
  return {
    titre: "Annuler ce versement ?",
    explication: `Le versement de ${versement.montant} € du ${formaterDateCourteFr(versement.dateVersement)} ne comptera plus dans les sommes reçues${revenus}, et le statut du paiement sera recalculé. Il reste affiché, grisé, sous le paiement. Cette annulation ne peut pas être défaite depuis l'application.`,
    libelleConfirmer: "Annuler le versement",
    libelleEnCours: "Annulation…",
    messageRepli: "Impossible d'annuler ce versement."
  };
}

// Événement : masqué du calendrier (liste et mois) et retiré du flux
// d'abonnement ICS (EvenementsCalendrierService.findAllPourOrganisation).
export function texteArchivageEvenement(evenement: Pick<EvenementCalendrier, "titre">): TexteConfirmation {
  return {
    titre: "Archiver l'événement ?",
    explication: `« ${evenement.titre} » sera masqué du calendrier (visible avec « Afficher les archivés ») et retiré du calendrier abonné. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Archiver l'événement",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver cet événement."
  };
}

// Candidat et contact professionnel : masqués de leur liste et des
// destinataires proposés par la messagerie (ContactsService
// .findAllUnifie exclut les archivés).
export function texteArchivageCandidat(candidat: Pick<Candidat, "prenom" | "nom">): TexteConfirmation {
  const nom = candidat.prenom ? `${candidat.prenom} ${candidat.nom}` : candidat.nom;
  return {
    titre: "Archiver ce candidat ?",
    explication: `${nom} sera masqué de la liste des candidats (visible avec « Afficher les archivés ») et ne sera plus proposé comme destinataire dans la messagerie. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Archiver le candidat",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver ce candidat."
  };
}

export function texteArchivageContact(contact: Pick<Contact, "nom">): TexteConfirmation {
  return {
    titre: "Archiver ce contact ?",
    explication: `${contact.nom} sera masqué du carnet de contacts (visible avec « Afficher les archivés ») et ne sera plus proposé comme destinataire dans la messagerie. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Archiver le contact",
    libelleEnCours: "Archivage…",
    messageRepli: "Impossible d'archiver ce contact."
  };
}

// Règle de catégorisation : les règles archivées ne sont plus lues à
// l'import (RegleCategorisationService.findAllActives).
export function texteRetraitRegle(regle: Pick<RegleCategorisation, "motCle">): TexteConfirmation {
  return {
    titre: "Retirer la règle ?",
    explication: `Le mot-clé « ${regle.motCle} » ne présélectionnera plus de catégorie à l'import CSV. ${PHRASE_ARCHIVAGE_IRREVERSIBLE}`,
    libelleConfirmer: "Retirer la règle",
    libelleEnCours: "Retrait…",
    messageRepli: "Impossible de retirer cette règle."
  };
}
