import { date, integer, pgEnum, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";

export const documentEntiteTypeEnum = pgEnum("document_entite_type", [
  "sci",
  "immeuble",
  "appartement",
  "locataire",
  "bail",
  // Photos prises pendant la saisie numérique de l'état des lieux
  // (module État des lieux, 2026-08-03) — réutilise le lien polymorphe
  // existant plutôt qu'un nouveau mécanisme de stockage.
  "etat_des_lieux",
  // Checklist documentaire (2026-08-24, docs/backlog.md) : aucun moyen
  // d'attacher un document à un garant n'existait jusqu'ici. Rejoint le
  // même mécanisme que locataire/bail plutôt qu'un système dédié — un
  // garant peut légitimement avoir plus qu'une pièce d'identité un jour
  // (RIB, attestation Visale...).
  "garant",
  // Migration bien (2026-08-26, docs/backlog.md) : sans cette valeur, aucun
  // document ne peut se rattacher à un bien non-immeuble (maison, parking,
  // bureau, local_commercial) dès sa création — 'immeuble' reste utilisé
  // tel quel pour les documents déjà rattachés à une ligne immeubles
  // existante (table conservée, voir bien.ts), 'bien' est le SEUL chemin
  // possible pour les nouveaux biens créés via BienService.
  "bien",
  // Module Charges et fiscalité, Étape 1 (2026-09-06, docs/backlog.md) :
  // permet de rattacher un document à une dépense, même mécanisme
  // polymorphe que les 3 précédents. Aucun flux d'upload de document pour
  // une dépense n'existe encore à ce jour (Étape 1 = create/findAll de
  // depense uniquement) — cette valeur seule ne suffirait pas à insérer une
  // ligne `documents` avec categorie appropriée (voir documentCategorieEnum
  // ci-dessous, aucune valeur ajoutée pour ce cas tant qu'aucun flux réel
  // n'en a besoin).
  "depense",
  // Module Calendrier/Candidats (2026-09-15) : pièces jointes d'un
  // candidat locataire (pièce d'identité, justificatifs de revenu...),
  // même mécanisme polymorphe que les précédents.
  "candidat",
  // Module Suivi sinistre et assurance (2026-09-16) : photos, rapport
  // d'expertise, courriers assureur — même mécanisme polymorphe.
  "sinistre"
]);

export const documentCategorieEnum = pgEnum("document_categorie", [
  "bail",
  "assurance",
  "etat_des_lieux",
  // "diagnostic" reste le seau générique pour tout diagnostic non encore
  // distingué (ex. amiante — hors périmètre à ce jour, docs/backlog.md,
  // section "Édition d'un bail"). dpe/elec_gaz/crep_plomb/erp existent en
  // valeurs dédiées uniquement pour permettre à BailDocumentDocxService de
  // détecter leur présence en pièce annexée (section PIECES ANNEXEES) —
  // aucun résultat structuré n'est stocké ici (voir la table `diagnostics`,
  // 1:1 avec documents, pour ça — encore non reliée à aucun module/UI à ce
  // jour, docs/backlog.md).
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
  // Checklist documentaire du candidat locataire (module Calendrier/
  // Candidats, extension 2026-09-15) : pièces attendues pour le candidat
  // ET pour son garant (voir documentCandidatRoleEnum ci-dessous) —
  // fiche_de_paie peut apparaître plusieurs fois pour la même entité
  // (3 attendues), aucune contrainte d'unicité ne l'empêche.
  "fiche_de_paie",
  "contrat_travail",
  "avis_imposition"
]);

// 'valide'/'expire' sont calculés à la lecture (packages/core,
// calculerStatutDocument) tant que le job du Module 6 n'existe pas — voir
// docs/data-dictionary.md, section documents. 'archive' est la seule valeur
// réellement écrite par ce module (archiver()).
export const documentStatutEnum = pgEnum("document_statut", ["valide", "expire", "archive"]);

// Sous-classification de la pièce concernée, valable uniquement quand
// entiteType = 'etat_des_lieux' (photos prises depuis le parcours mobile
// pas-à-pas, un bouton "+ Photo" par pièce) — voir docs/error-log.md,
// [2026-08-07] Photos état des lieux non rattachées aux pièces. Les 7
// valeurs correspondent exactement aux étapes "piece-*" du parcours
// mobile (apps/mobile-web/src/etat-des-lieux/stepper-config.ts), sans le
// préfixe "piece-".
export const documentEtatDesLieuxPieceTypeEnum = pgEnum("document_etat_des_lieux_piece_type", [
  "entree",
  "sejour",
  "cuisine",
  "chambre",
  "salle_de_bain",
  "wc",
  "autre"
]);

// Distingue un document du candidat lui-même de celui de son garant,
// valable uniquement quand entiteType = 'candidat' — le garant d'un
// candidat n'est pas une entité `garant` réelle (juste garant_nom/
// garant_revenu_mensuel_net en texte sur `candidat`), donc entiteType/
// entiteId seuls ne suffisent pas à savoir à qui appartient le document
// (extension checklist candidat, 2026-09-15).
export const documentCandidatRoleEnum = pgEnum("document_candidat_role", ["candidat", "garant"]);

export const documents = pgTable("documents", {
  ...auditColumns,
  // Lien polymorphe : pas de contrainte de clé étrangère possible (5 tables
  // cibles), la cohérence entiteType/entiteId est vérifiée applicativement
  // (DocumentsService) à la création.
  entiteType: documentEntiteTypeEnum("entite_type").notNull(),
  entiteId: uuid("entite_id").notNull(),
  categorie: documentCategorieEnum("categorie").notNull(),
  statut: documentStatutEnum("statut").notNull().default("valide"),
  dateExpiration: date("date_expiration"),
  nomFichier: text("nom_fichier").notNull(),
  mimeType: text("mime_type").notNull(),
  tailleOctets: integer("taille_octets").notNull(),
  // Clé/chemin du blob chiffré sur disque (repli local temporaire, voir
  // docs/data-dictionary.md) — jamais exposé au frontend.
  cheminStockage: text("chemin_stockage").notNull(),
  // Nullables : identifient la pièce précise pour une photo d'état des
  // lieux (numero seulement pour chambre/salle_de_bain/wc/autre, null pour
  // entrée/séjour/cuisine à instance unique) — jamais renseignés pour les
  // 5 autres entiteType.
  etatDesLieuxPieceType: documentEtatDesLieuxPieceTypeEnum("etat_des_lieux_piece_type"),
  etatDesLieuxPieceNumero: integer("etat_des_lieux_piece_numero"),
  // Nullable, exigé uniquement quand entiteType = 'candidat' (vérifié
  // applicativement, voir DocumentsService.verifierPieceValideSelonEntiteType) —
  // jamais renseigné pour les 6 autres entiteType.
  candidatRole: documentCandidatRoleEnum("candidat_role"),
  // Versioning (docs/backlog.md, dette technique) : auto-référence vers la
  // ligne que ce document remplace. La version courante d'une chaîne est
  // celle qu'aucune autre ligne ne référence ici. DocumentsService
  // .remplacerDocument() archive automatiquement l'ancienne version dans
  // la même transaction que la création de la nouvelle — jamais de
  // suppression physique (CLAUDE.md), jamais deux versions 'valide'
  // simultanées dans une même chaîne.
  documentPrecedentId: uuid("document_precedent_id").references((): AnyPgColumn => documents.id)
});
