import { date, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";

export const documentEntiteTypeEnum = pgEnum("document_entite_type", [
  "sci",
  "immeuble",
  "appartement",
  "locataire",
  "bail"
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
  cheminStockage: text("chemin_stockage").notNull()
});
