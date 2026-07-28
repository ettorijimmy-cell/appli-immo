import { sql } from "drizzle-orm";
import { boolean, date, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";

export const alerteTypeEnum = pgEnum("alerte_type", [
  "bail_fin_proche",
  "document_expire",
  "document_expire_proche",
  "entretien_equipement",
  "impaye"
]);

// 'resolue' : fermée automatiquement par le job quand la condition
// déclenchante n'est plus vraie (docs/data-dictionary.md, section
// alertes) — distincte de 'traitee'/'ignoree' (décisions humaines
// explicites, jamais écrasées par le job).
export const alerteStatutEnum = pgEnum("alerte_statut", ["active", "traitee", "ignoree", "resolue"]);

export const alertes = pgTable(
  "alertes",
  {
    ...auditColumns,
    type: alerteTypeEnum("type").notNull(),
    // Id de la ligne concernée — la table cible se déduit de `type` (bail
    // pour bail_fin_proche, paiement pour impaye, document pour
    // document_expire(_proche), equipement pour entretien_equipement). Pas
    // de FK possible (cibles différentes selon le type), même principe que
    // `documents.entite_id`.
    entiteId: uuid("entite_id").notNull(),
    statut: alerteStatutEnum("statut").notNull().default("active"),
    message: text("message").notNull(),
    // Date métier à laquelle l'alerte se rapporte (date_fin du bail,
    // date_expiration du document, prochaine date d'entretien calculée, ou
    // date_echeance du paiement en retard) — évite de recharger l'entité
    // source uniquement pour l'afficher/la trier.
    dateReference: date("date_reference").notNull(),
    // Champ interne, jamais exposé à l'utilisateur : mémorise si la
    // condition déclenchante était vraie au dernier passage du job, y
    // compris pour une alerte traitee/ignoree (dont le `statut`, lui, n'est
    // jamais réécrit par le job). Sert uniquement à détecter une vraie
    // transition faux→vrai (nouvelle occurrence) plutôt que de recréer une
    // alerte chaque jour tant que la condition reste vraie sans
    // interruption — voir docs/data-dictionary.md, section alertes.
    // Défaut `true` pour les lignes existantes lors de la migration
    // d'ajout : au pire, une occurrence déjà traitee/ignoree ne redéclenche
    // pas tant que le job ne l'observe pas passer par faux au moins une
    // fois après coup (comportement sûr, jamais de duplication intempestive).
    derniereConditionVraie: boolean("derniere_condition_vraie").notNull().default(true)
  },
  (table) => [
    // Idempotence au niveau base, mais PAS un (type, entite_id) unique en
    // permanence : plusieurs alertes peuvent exister dans le temps pour la
    // même entité (une par occurrence, docs/data-dictionary.md) si une
    // occurrence précédente a été traitee/ignoree puis que le problème
    // revient. La contrainte garantit seulement qu'il n'existe jamais plus
    // d'UNE alerte ACTIVE à la fois pour un (type, entite_id) donné —
    // 'resolue' peut se rouvrir en place (update), jamais un nouvel insert
    // pendant qu'une ligne 'active' existe déjà.
    uniqueIndex("alertes_type_entite_id_active_unique")
      .on(table.type, table.entiteId)
      .where(sql`${table.statut} = 'active'`)
  ]
);
