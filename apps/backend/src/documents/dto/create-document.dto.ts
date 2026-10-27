import { Transform } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Min } from "class-validator";

export const DOCUMENT_ENTITE_TYPES = [
  "sci",
  "immeuble",
  "appartement",
  "locataire",
  "bail",
  "etat_des_lieux",
  "garant",
  // Migration bien (2026-08-26, docs/backlog.md) : seul chemin possible
  // pour rattacher un document à un bien créé via BienService, y compris
  // un immeuble créé après cette date — 'immeuble' reste réservé aux
  // documents déjà rattachés à une ligne immeubles existante.
  "bien",
  // Module Charges et fiscalité, Étape 1 (2026-09-06, docs/backlog.md) :
  // permet de rattacher un document à une dépense — aucun flux d'upload
  // n'existe encore pour ce cas (voir packages/db/src/schema/documents.ts).
  "depense",
  // Module Calendrier/Candidats (2026-09-15) : pièces jointes d'un
  // candidat locataire.
  "candidat",
  // Module Suivi sinistre et assurance (2026-09-16) : photos, rapport
  // d'expertise, courriers assureur.
  "sinistre"
] as const;
export type DocumentEntiteType = (typeof DOCUMENT_ENTITE_TYPES)[number];

export const DOCUMENT_CATEGORIES = [
  "bail",
  "assurance",
  "etat_des_lieux",
  "diagnostic",
  "dpe",
  "elec_gaz",
  "crep_plomb",
  "erp",
  "piece_identite",
  "rib",
  "caf",
  "quittance",
  "courrier",
  "photo",
  // Checklist documentaire du candidat locataire (extension 2026-09-15) :
  // pièces attendues pour le candidat et pour son garant (voir
  // DOCUMENT_CANDIDAT_ROLES ci-dessous). fiche_de_paie peut apparaître
  // plusieurs fois pour la même entité (3 attendues) — aucune contrainte
  // d'unicité ne l'empêche (voir packages/db/src/schema/documents.ts).
  "fiche_de_paie",
  "contrat_travail",
  "avis_imposition",
  // Image de signature de l'état des lieux (chantier Signatures,
  // 2026-10-25) — valeur RÉELLE de documents.categorie (voir
  // packages/db/src/schema/documents.ts) mais jamais une valeur que cette
  // route générique doit accepter : listée ici uniquement pour que
  // DocumentsService puisse comparer dto.categorie === "signature" et la
  // refuser explicitement (creerDepuisBuffer/update/remplacerDocument),
  // plutôt que de compter implicitement sur son absence de cette liste.
  // Seul EtatsDesLieuxSignatureService crée ces documents, par un insert
  // direct dans sa propre transaction de signature.
  "signature",
  // .docx figé et PDF de l'état des lieux (chantier PDF, étape 4,
  // 2026-10-27) — valeurs RÉELLES de documents.categorie, mais jamais des
  // valeurs que cette route générique doit accepter : listées ici
  // uniquement pour que DocumentsService puisse les refuser explicitement
  // (creerDepuisBuffer/update/remplacerDocument/archiver), même principe
  // que "signature" ci-dessus. Seul le service de génération PDF de
  // l'état des lieux crée/archive ces documents.
  "etat_des_lieux_docx",
  "etat_des_lieux_pdf"
] as const;
export type DocumentCategorie = (typeof DOCUMENT_CATEGORIES)[number];

// Distingue un document du candidat lui-même de celui de son garant —
// obligatoire quand entiteType = 'candidat', interdit sinon (vérifié
// applicativement dans DocumentsService.upload, même principe que
// etatDesLieuxPieceType/Numero ci-dessous). Le garant d'un candidat n'est
// pas une entité `garant` réelle (juste garant_nom/garant_revenu_mensuel_net
// en texte sur `candidat`), donc entiteType/entiteId seuls ne suffisent
// pas à distinguer les deux jeux de documents.
export const DOCUMENT_CANDIDAT_ROLES = ["candidat", "garant"] as const;
export type DocumentCandidatRole = (typeof DOCUMENT_CANDIDAT_ROLES)[number];

// Correspond exactement aux étapes "piece-*" du parcours mobile pas-à-pas
// (apps/mobile-web/src/etat-des-lieux/stepper-config.ts), sans le préfixe
// "piece-" — voir packages/db/src/schema/documents.ts.
export const DOCUMENT_ETAT_DES_LIEUX_PIECE_TYPES = [
  "entree",
  "sejour",
  "cuisine",
  "chambre",
  "salle_de_bain",
  "wc",
  "autre"
] as const;
export type DocumentEtatDesLieuxPieceType = (typeof DOCUMENT_ETAT_DES_LIEUX_PIECE_TYPES)[number];

export class CreateDocumentDto {
  @IsIn(DOCUMENT_ENTITE_TYPES)
  entiteType!: DocumentEntiteType;

  @IsUUID()
  entiteId!: string;

  @IsIn(DOCUMENT_CATEGORIES)
  categorie!: DocumentCategorie;

  @IsOptional()
  @IsDateString()
  dateExpiration?: string;

  // Uniquement significatif quand entiteType = 'etat_des_lieux' — vérifié
  // applicativement dans DocumentsService.upload (même principe que
  // verifierEntiteExiste, pas de contrainte DB possible sur un couple
  // conditionnel).
  @IsOptional()
  @IsIn(DOCUMENT_ETAT_DES_LIEUX_PIECE_TYPES)
  etatDesLieuxPieceType?: DocumentEtatDesLieuxPieceType;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === "" ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  etatDesLieuxPieceNumero?: number;

  // Obligatoire quand entiteType = 'candidat', interdit sinon — vérifié
  // applicativement dans DocumentsService.upload.
  @IsOptional()
  @IsIn(DOCUMENT_CANDIDAT_ROLES)
  candidatRole?: DocumentCandidatRole;
}
