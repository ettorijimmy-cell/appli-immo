import { situationLocataireCautionne } from "core";
import { valeurOuNull } from "../lib/valeur-ou-null";
import type {
  CreateGarantInput,
  Garant,
  GarantTypeGarantie,
  GarantTypeSaisissable,
  UpdateGarantInput
} from "./api";

// Types proposés à la saisie (chantier garants, 2026-11-08) : « autre » n'est
// plus accepté par l'API ; une ligne « autre » existante reste affichée avec
// son libellé et un message invitant à changer de type.
export const GARANT_TYPES_SAISISSABLES: GarantTypeSaisissable[] = ["personne_physique", "garantie_visale"];

export const LIBELLES_TYPE_GARANTIE: Record<GarantTypeGarantie, string> = {
  personne_physique: "Caution (personne physique)",
  garantie_visale: "Garantie Visale",
  autre: "Autre (ancien type)"
};

// Nom imposé par le backend pour une garantie Visale (GarantsService,
// NOM_GARANT_VISALE) : affiché, jamais saisi ni envoyé.
export const NOM_GARANT_VISALE = "Action Logement Services (Visale)";

export const MESSAGE_TYPE_AUTRE =
  "Ancien type « Autre », qui n'est plus accepté : choisissez « Caution (personne physique) » ou « Garantie Visale ».";

export const RAPPEL_CONTRAT_VISALE = "Contrat Visale (PDF) à joindre";

// Nom affiché dans les listes : « Prénom Nom », ou le nom seul quand il n'y
// a pas de prénom (garantie Visale).
export function nomAfficheGarant(garant: { nom: string; prenom: string | null }): string {
  return garant.prenom ? `${garant.prenom} ${garant.nom}` : garant.nom;
}

// Valeurs saisies dans les formulaires garant (chaînes brutes des champs,
// "" pour un champ vide). Partagé par NewGarantForm et EditGarantForm
// (GarantForms.tsx), utilisés depuis la fiche locataire et l'onglet
// « Bail actuel ».
export interface ChampsGarant {
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  typeGarantie: GarantTypeGarantie;
  numeroContratVisale: string;
  adresse: string;
  codePostal: string;
  ville: string;
  dateNaissance: string;
  lieuNaissance: string;
  nationalite: string;
  // Locataire du bail dont le garant se porte caution ("" = non précisé).
  locataireId: string;
}

export function champsGarantVides(locataireIdParDefaut = ""): ChampsGarant {
  return {
    nom: "",
    prenom: "",
    email: "",
    telephone: "",
    typeGarantie: "personne_physique",
    numeroContratVisale: "",
    adresse: "",
    codePostal: "",
    ville: "",
    dateNaissance: "",
    lieuNaissance: "",
    nationalite: "",
    locataireId: locataireIdParDefaut
  };
}

export function champsGarantDepuis(garant: Garant): ChampsGarant {
  return {
    nom: garant.nom,
    prenom: garant.prenom ?? "",
    email: garant.email ?? "",
    telephone: garant.telephone ?? "",
    typeGarantie: garant.typeGarantie,
    numeroContratVisale: garant.numeroContratVisale ?? "",
    adresse: garant.adresse ?? "",
    codePostal: garant.codePostal ?? "",
    ville: garant.ville ?? "",
    dateNaissance: garant.dateNaissance ?? "",
    lieuNaissance: garant.lieuNaissance ?? "",
    nationalite: garant.nationalite ?? "",
    locataireId: garant.locataireId ?? ""
  };
}

// Changement de type dans le formulaire : rien n'est effacé tant que
// l'utilisateur n'enregistre pas (revenir au type d'origine restitue les
// valeurs). Seul le nom imposé de Visale est retiré en passant en caution,
// pour que le nom de la personne soit saisi.
export function changerTypeGarant(champs: ChampsGarant, typeGarantie: GarantTypeSaisissable): ChampsGarant {
  return {
    ...champs,
    typeGarantie,
    nom: typeGarantie === "personne_physique" && champs.nom === NOM_GARANT_VISALE ? "" : champs.nom
  };
}

// Création : un champ facultatif vide est omis (rien à effacer). Garantie
// Visale : seulement le numéro de contrat, l'e-mail et le téléphone (nom et
// prénom imposés par le backend).
export function creationGarant(bailId: string, champs: ChampsGarant): CreateGarantInput {
  const contact = {
    ...(champs.email && { email: champs.email }),
    ...(champs.telephone && { telephone: champs.telephone })
  };
  if (champs.typeGarantie === "garantie_visale") {
    return {
      bailId,
      typeGarantie: "garantie_visale",
      ...(champs.numeroContratVisale && { numeroContratVisale: champs.numeroContratVisale }),
      ...contact
    };
  }
  return {
    bailId,
    nom: champs.nom,
    prenom: champs.prenom,
    typeGarantie: "personne_physique",
    ...contact,
    ...(champs.adresse && { adresse: champs.adresse }),
    ...(champs.codePostal && { codePostal: champs.codePostal }),
    ...(champs.ville && { ville: champs.ville }),
    ...(champs.dateNaissance && { dateNaissance: champs.dateNaissance }),
    ...(champs.lieuNaissance && { lieuNaissance: champs.lieuNaissance }),
    ...(champs.nationalite && { nationalite: champs.nationalite }),
    ...(champs.locataireId && { locataireId: champs.locataireId })
  };
}

// Modification : un champ facultatif vidé est envoyé en `null` explicite
// pour l'effacer en base (voir UpdateGarantInput, valeurOuNull).
// - Visale : numéro, e-mail, téléphone ; le backend vide le reste.
// - Caution : champs de personne, sans numéro Visale (effacé par le backend).
// - Ligne « autre » gardée telle quelle : type omis (refusé en écriture),
//   prénom envoyé seulement s'il est renseigné.
export function modificationGarant(champs: ChampsGarant): UpdateGarantInput {
  const contact = { email: valeurOuNull(champs.email), telephone: valeurOuNull(champs.telephone) };
  if (champs.typeGarantie === "garantie_visale") {
    return {
      typeGarantie: "garantie_visale",
      numeroContratVisale: valeurOuNull(champs.numeroContratVisale),
      ...contact
    };
  }
  const champsPersonne = {
    ...contact,
    adresse: valeurOuNull(champs.adresse),
    codePostal: valeurOuNull(champs.codePostal),
    ville: valeurOuNull(champs.ville),
    dateNaissance: valeurOuNull(champs.dateNaissance),
    lieuNaissance: valeurOuNull(champs.lieuNaissance),
    nationalite: valeurOuNull(champs.nationalite),
    locataireId: valeurOuNull(champs.locataireId)
  };
  if (champs.typeGarantie === "autre") {
    return { nom: champs.nom, ...(champs.prenom && { prenom: champs.prenom }), ...champsPersonne };
  }
  return { nom: champs.nom, prenom: champs.prenom, typeGarantie: "personne_physique", ...champsPersonne };
}

const CHAMPS_VIDES_POUR_VISALE: ReadonlyArray<[keyof ChampsGarant, string]> = [
  ["prenom", "prénom"],
  ["adresse", "adresse"],
  ["codePostal", "code postal"],
  ["ville", "ville"],
  ["dateNaissance", "date de naissance"],
  ["lieuNaissance", "lieu de naissance"],
  ["nationalite", "nationalité"],
  ["locataireId", "« Caution de »"]
];

// Confirmation avant d'enregistrer un changement de type : dit ce qui sera
// vidé côté serveur (GarantsService.update). null : pas de changement de
// type, ou rien à vider.
export function confirmationChangementType(typeInitial: GarantTypeGarantie, champs: ChampsGarant): string | null {
  if (champs.typeGarantie === typeInitial) {
    return null;
  }
  if (champs.typeGarantie === "garantie_visale") {
    const vides = CHAMPS_VIDES_POUR_VISALE.filter(([cle]) => champs[cle] !== "").map(([, libelle]) => libelle);
    return [
      "Passer ce garant en « Garantie Visale » :",
      `- le nom sera remplacé par « ${NOM_GARANT_VISALE} » ;`,
      ...(vides.length > 0 ? [`- seront vidés : ${vides.join(", ")} ;`] : []),
      "- l'e-mail et le téléphone sont conservés.",
      "Continuer ?"
    ].join("\n");
  }
  if (typeInitial === "garantie_visale" && champs.numeroContratVisale !== "") {
    return [
      "Passer ce garant en « Caution (personne physique) » :",
      `- le numéro de contrat Visale (${champs.numeroContratVisale}) sera effacé.`,
      "Continuer ?"
    ].join("\n");
  }
  return null;
}

// « Caution de » : obligatoire quand le bail a plusieurs locataires (sinon
// la caution garantit le locataire unique). Signalé, jamais bloquant à la
// saisie (la génération du bail le bloque).
export function cautionDeObligatoire(locatairesDuBail: readonly unknown[]): boolean {
  return locatairesDuBail.length > 1;
}

// Locataire proposé dans le champ « Caution de » : un locataire rattaché
// au bail (lien non archivé).
export interface LocataireDuBail {
  id: string;
  prenom: string;
  nom: string;
}

export interface OptionCautionDe {
  valeur: string;
  libelle: string;
}

export const LIBELLE_NON_PRECISE = "Non précisé";
export const MENTION_PLUS_AU_BAIL = "(n'est plus au bail)";

// Options du champ « Caution de » : « Non précisé », puis les locataires
// du bail. Si la valeur déjà enregistrée désigne un locataire qui a quitté
// le bail, elle reste proposée (et sélectionnée) avec la mention « (n'est
// plus au bail) », pour qu'un enregistrement sans changement ne la perde
// pas — le backend l'accepte telle quelle (GarantsService.update).
export function optionsCautionDe(
  locatairesDuBail: readonly LocataireDuBail[],
  valeurEnregistree: string,
  nomsLocataires: ReadonlyMap<string, string>
): OptionCautionDe[] {
  const options: OptionCautionDe[] = [
    { valeur: "", libelle: LIBELLE_NON_PRECISE },
    ...locatairesDuBail.map((l) => ({ valeur: l.id, libelle: `${l.prenom} ${l.nom}` }))
  ];
  if (valeurEnregistree && !locatairesDuBail.some((l) => l.id === valeurEnregistree)) {
    const nom = nomsLocataires.get(valeurEnregistree) ?? "Locataire";
    options.push({ valeur: valeurEnregistree, libelle: `${nom} ${MENTION_PLUS_AU_BAIL}` });
  }
  return options;
}

// Mention affichée dans la liste des garants : « caution de Marie Dupont »,
// suivie de « (n'est plus au bail) » si ce locataire a été retiré du bail ;
// null si le garant n'est rattaché à personne (non précisé).
export function mentionCautionDe(
  locataireId: string | null,
  locataireIdsAuBail: readonly string[],
  nomsLocataires: ReadonlyMap<string, string>
): string | null {
  const situation = situationLocataireCautionne(locataireId, locataireIdsAuBail);
  if (situation === "non_precise" || locataireId === null) {
    return null;
  }
  const mention = `caution de ${nomsLocataires.get(locataireId) ?? "locataire inconnu"}`;
  return situation === "plus_au_bail" ? `${mention} ${MENTION_PLUS_AU_BAIL}` : mention;
}
