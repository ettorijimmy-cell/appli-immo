import { sql } from "drizzle-orm";
import { date, pgEnum, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { baux } from "./baux";
import { auditColumns } from "./columns.helpers";
import { locataires } from "./locataires";

// Table de liaison pour la colocation : un bail peut avoir plusieurs
// locataires, chacun avec un rôle. Retirer un locataire d'un bail archive
// la ligne de liaison (archivedAt), jamais de suppression physique.
export const bailLocataireRoleEnum = pgEnum("bail_locataire_role", ["titulaire", "colocataire"]);

export const bailLocataires = pgTable(
  "bail_locataires",
  {
    ...auditColumns,
    bailId: uuid("bail_id")
      .notNull()
      .references(() => baux.id),
    locataireId: uuid("locataire_id")
      .notNull()
      .references(() => locataires.id),
    role: bailLocataireRoleEnum("role").notNull(),
    // Date d'effet du congé donné par ce locataire (2026-11-08, chantier
    // garants, migration 0078). Sert à afficher la fin d'engagement de sa
    // caution en colocation (loi n° 89-462, art. 8-1, VI). Distincte
    // d'archived_at, qui est la date de retrait du lien dans l'appli.
    dateEffetConge: date("date_effet_conge")
  },
  (table) => [
    // Audit de données réalisé le 2026-08-31 (avant ajout de cette
    // contrainte) : zéro bail actif/préavis sur Scaleway au moment de
    // l'ajout, donc aucun risque de violation par une donnée réelle
    // existante. Non scopée par statut de bail (contrairement à
    // baux_appartement_id_actif_unique) : un index partiel ne peut
    // référencer que les colonnes de sa propre table, et il n'y a de
    // toute façon aucune raison légitime qu'un bail — quel que soit son
    // statut — ait plus d'un titulaire non archivé à la fois. Le cas
    // zéro titulaire (bail avec uniquement des colocataires) reste
    // possible et volontairement non contraint ici — voir
    // TachesJobService, résolution du titulaire pour la notification.
    uniqueIndex("bail_locataires_bail_id_titulaire_actif_unique")
      .on(table.bailId)
      .where(sql`${table.role} = 'titulaire' AND ${table.archivedAt} IS NULL`)
  ]
);
