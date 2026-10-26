import { boolean, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { etatsDesLieux } from "./etats-des-lieux";

// 6 types fixes + "autre" (2 emplacements libres dans le modèle réel,
// distingués par une ligne chacun, libelle_autre renseigné uniquement
// pour ce type).
export const etatDesLieuxTypeCleEnum = pgEnum("etat_des_lieux_type_cle", [
  "immeuble",
  "porte_entree",
  "boite_lettres",
  "cave",
  "badge_portail",
  "parking",
  "autre"
]);

export const etatDesLieuxCles = pgTable("etat_des_lieux_cles", {
  ...auditColumns,
  etatDesLieuxId: uuid("etat_des_lieux_id")
    .notNull()
    .references(() => etatsDesLieux.id),
  typeCle: etatDesLieuxTypeCleEnum("type_cle").notNull(),
  // Renseigné uniquement si type_cle = "autre".
  libelleAutre: text("libelle_autre"),
  nombreEntree: integer("nombre_entree"),
  nombreSortie: integer("nombre_sortie"),
  commentaire: text("commentaire"),
  // Posée par l'application (jamais recalculée après coup) au moment de
  // l'insertion d'une ligne NEUVE alors que l'entrée est déjà signée (ex.
  // une clé remise en cours de bail) — seules ces lignes restent
  // retirables jusqu'à la signature de sortie, voir
  // upsertEtArchiverParId (apps/backend/etats-des-lieux.service.ts).
  // Volontairement un flag stocké à l'écriture, PAS déduit après coup
  // d'une comparaison d'horodatage/id : ces comparaisons se sont révélées
  // non fiables (régression de test 2026-10-26 — now() Postgres figé par
  // transaction, puis collision de millisecondes sur l'id UUID v7 généré
  // côté Node pour deux insertions rapprochées).
  ajouteeApresSignatureEntree: boolean("ajoutee_apres_signature_entree").notNull().default(false)
});
