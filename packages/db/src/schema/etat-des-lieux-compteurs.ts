import { decimal, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { etatsDesLieux } from "./etats-des-lieux";

// Relevés de compteurs (décret n° 2016-382, art. 2, 1° f — "le cas
// échéant"). Colonne Internet retirée du modèle réel par le propriétaire
// (aucun champ structuré derrière dans le document d'origine). Pas de
// numéro de compteur pour l'eau : absent du modèle réel, vérifié.
export const etatDesLieuxCompteurs = pgTable("etat_des_lieux_compteurs", {
  ...auditColumns,
  etatDesLieuxId: uuid("etat_des_lieux_id")
    .notNull()
    .unique()
    .references(() => etatsDesLieux.id),
  electriciteNumeroCompteurEntree: text("electricite_numero_compteur_entree"),
  electriciteNumeroCompteurSortie: text("electricite_numero_compteur_sortie"),
  electriciteReleveHpEntree: decimal("electricite_releve_hp_entree", { precision: 10, scale: 2 }),
  electriciteReleveHpSortie: decimal("electricite_releve_hp_sortie", { precision: 10, scale: 2 }),
  electriciteReleveHcEntree: decimal("electricite_releve_hc_entree", { precision: 10, scale: 2 }),
  electriciteReleveHcSortie: decimal("electricite_releve_hc_sortie", { precision: 10, scale: 2 }),
  // Dernier relevé de l'ancien occupant, référence pour la continuité de
  // facturation — présent aux deux moments (entrée/sortie) dans le
  // modèle réel du propriétaire, reproduit tel quel (Option B).
  electriciteAncienOccupantEntree: decimal("electricite_ancien_occupant_entree", {
    precision: 10,
    scale: 2
  }),
  electriciteAncienOccupantSortie: decimal("electricite_ancien_occupant_sortie", {
    precision: 10,
    scale: 2
  }),
  gazNumeroCompteurEntree: text("gaz_numero_compteur_entree"),
  gazNumeroCompteurSortie: text("gaz_numero_compteur_sortie"),
  gazReleveEntree: decimal("gaz_releve_entree", { precision: 10, scale: 2 }),
  gazReleveSortie: decimal("gaz_releve_sortie", { precision: 10, scale: 2 }),
  eauReleveFroideEntree: decimal("eau_releve_froide_entree", { precision: 10, scale: 2 }),
  eauReleveFroideSortie: decimal("eau_releve_froide_sortie", { precision: 10, scale: 2 }),
  eauReleveChaudeEntree: decimal("eau_releve_chaude_entree", { precision: 10, scale: 2 }),
  eauReleveChaudeSortie: decimal("eau_releve_chaude_sortie", { precision: 10, scale: 2 })
});
