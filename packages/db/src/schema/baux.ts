import { date, decimal, integer, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { appartements } from "./appartements";
import { auditColumns } from "./columns.helpers";

export const bailTypeBailEnum = pgEnum("bail_type_bail", ["vide", "meuble"]);
// brouillon -> actif -> (preavis) -> resilie -> archive. Le passage à "actif"
// et "resilie" déclenche la transition automatique du statut de
// l'appartement (packages/core, apps/backend/src/baux/baux.service.ts) —
// jamais via une modification générique de `statut`, qui n'existe pas dans
// UpdateBailDto.
export const bailStatutEnum = pgEnum("bail_statut", [
  "brouillon",
  "actif",
  "preavis",
  "resilie",
  "archive"
]);

export const baux = pgTable("baux", {
  ...auditColumns,
  appartementId: uuid("appartement_id")
    .notNull()
    .references(() => appartements.id),
  typeBail: bailTypeBailEnum("type_bail").notNull(),
  statut: bailStatutEnum("statut").notNull().default("brouillon"),
  // Pré-rempli depuis appartements.loyer_reference à la création si non
  // fourni explicitement (packages/core, preremplirLoyerBail) — reste
  // modifiable ensuite, un bail peut différer de la référence.
  loyerMensuel: decimal("loyer_mensuel", { precision: 10, scale: 2 }),
  depotGarantie: decimal("depot_garantie", { precision: 10, scale: 2 }),
  // Provisions mensuelles pour charges, en plus du loyer HC (loyer_mensuel).
  // null traité comme 0 dans tout calcul (docs/data-dictionary.md).
  provisionsCharges: decimal("provisions_charges", { precision: 10, scale: 2 }),
  // Jour du mois de l'échéance de loyer, borné à 28 pour rester valide sur
  // tous les mois. Renseignable progressivement, mais requis pour activer()
  // (voir docs/data-dictionary.md — sans lui, impossible de générer la
  // première échéance).
  jourEcheance: integer("jour_echeance"),
  dateDebut: date("date_debut").notNull(),
  dateFin: date("date_fin"),
  // Posée une seule fois par activer(), jamais modifiée ensuite (pas dans
  // UpdateBailDto). Distincte de date_debut : un bail peut rester en
  // brouillon après sa date de début contractuelle, l'occupation réelle ne
  // commence qu'à l'activation si celle-ci est postérieure — utilisé par
  // resilier() pour déterminer le début réel d'occupation à proratiser
  // (docs/data-dictionary.md).
  dateActivation: date("date_activation")
});
