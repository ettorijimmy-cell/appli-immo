import { date, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
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
  "etat_des_lieux"
]);

export const documentCategorieEnum = pgEnum("document_categorie", [
  "bail",
  "assurance",
  "etat_des_lieux",
  "diagnostic",
  "dpe",
  "piece_identite",
  "rib",
  "caf",
  "quittance",
  "courrier",
  "photo"
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
  etatDesLieuxPieceNumero: integer("etat_des_lieux_piece_numero")
});
