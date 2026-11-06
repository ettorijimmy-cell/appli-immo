import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { documents } from "./documents";
import { etatsDesLieux } from "./etats-des-lieux";
import { utilisateurs } from "./utilisateurs";

// Signataire d'une entrée papier : copié à la déclaration, comme
// etat_des_lieux_signature.nom_affiche, pour que la mention du document
// de sortie reste celle du papier même si une fiche change ensuite.
export interface SignataireEntreePapier {
  role: "bailleur" | "locataire";
  // null pour le bailleur, l'id du locataire du bail sinon.
  locataireId: string | null;
  nomAffiche: string;
}

// Entrée d'état des lieux établie et signée sur papier (2026-11-06). La
// déclaration est définitive : date, lieu, scan et signataires restent
// corrigeables tant que la sortie n'est pas signée, mais chaque correction
// écrit une nouvelle ligne et archive la précédente (l'ancien scan est
// conservé). Exclusive avec une signature numérique d'entrée.
//
// Garanties portées par la base, posées à la main dans la migration
// (drizzle-kit ne gère pas les triggers) :
// - aucune suppression ni vidage de la table ;
// - une ligne n'est jamais modifiée, sauf pour être archivée une fois ;
// - aucune déclaration (ni correction) si une signature numérique d'entrée
//   ou une signature de sortie existe ;
// - aucune signature numérique d'entrée si une déclaration active existe.
// Hors publication et hors PowerSync, lue en REST uniquement. Voir
// docs/data-dictionary.md.
export const etatDesLieuxEntreePapier = pgTable(
  "etat_des_lieux_entree_papier",
  {
    ...auditColumns,
    etatDesLieuxId: uuid("etat_des_lieux_id")
      .notNull()
      .references(() => etatsDesLieux.id),
    // Date portée sur le papier (AAAA-MM-JJ), jamais dans le futur.
    dateSignature: date("date_signature").notNull(),
    lieu: text("lieu").notNull(),
    // Le scan PDF (documents.categorie='etat_des_lieux_entree_papier').
    // Une correction sans nouveau scan reprend le même document : plusieurs
    // lignes (une active, les autres archivées) peuvent donc le partager.
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    // Bailleur et au moins un locataire du bail, cochés à la déclaration.
    signataires: jsonb("signataires").$type<SignataireEntreePapier[]>().notNull(),
    declareeLe: timestamp("declaree_le", { withTimezone: true }).notNull(),
    declareePar: uuid("declaree_par")
      .notNull()
      .references(() => utilisateurs.id)
  },
  (table) => [
    // Une seule déclaration active par état des lieux ; les corrections
    // archivées restent en historique.
    uniqueIndex("etat_des_lieux_entree_papier_active_unique")
      .on(table.etatDesLieuxId)
      .where(sql`${table.archivedAt} IS NULL`),
    index("etat_des_lieux_entree_papier_historique_idx").on(table.etatDesLieuxId),
    check("etat_des_lieux_entree_papier_lieu_non_vide", sql`btrim(${table.lieu}) <> ''`),
    // Bailleur + au moins un locataire : au moins deux signataires.
    check(
      "etat_des_lieux_entree_papier_signataires_coherent",
      sql`jsonb_typeof(${table.signataires}) = 'array' AND jsonb_array_length(${table.signataires}) >= 2`
    )
  ]
);
