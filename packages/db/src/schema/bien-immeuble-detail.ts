import { decimal, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { bien } from "./bien";

// Extension 1:1 de bien pour le seul type 'immeuble' — même pattern que
// diagnostics (extension 1:1 de documents) : id propre + auditColumns
// complets, pas bienId en clé primaire. Des champs comme syndic ou
// chargesCoproAnnuelles changent dans le temps indépendamment du reste de
// bien (changement de syndic, révision annuelle des charges) — sans audit
// propre sur cette table, cette traçabilité serait perdue (décision du
// 2026-08-25, revient sur le DDL illustratif initial qui plaçait bienId en
// clé primaire sans colonnes d'audit).
// typeHabitat/regimeJuridique déplacés vers bien le 2026-08-26 : ce sont
// des mentions légales du LOGEMENT (contrat-type, décret n° 2015-587),
// pas des données de gestion de copropriété — contrairement à
// syndic/nbLots/chargesCoproAnnuelles ci-dessous, qui restent ici,
// exclusivement pertinents pour un immeuble en copropriété, sans
// équivalent pour un bien non-immeuble.
export const bienImmeubleDetail = pgTable("bien_immeuble_detail", {
  ...auditColumns,
  bienId: uuid("bien_id")
    .notNull()
    .unique()
    .references(() => bien.id, { onDelete: "cascade" }),
  syndic: text("syndic"),
  nbLots: integer("nb_lots"),
  chargesCoproAnnuelles: decimal("charges_copro_annuelles", { precision: 10, scale: 2 })
});
