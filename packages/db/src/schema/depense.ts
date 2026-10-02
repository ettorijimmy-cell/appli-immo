import { sql } from "drizzle-orm";
import { check, date, decimal, pgEnum, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { appartements } from "./appartements";
import { auditColumns } from "./columns.helpers";
import { bien } from "./bien";
import { organisations } from "./organisations";
import { scis } from "./scis";

// Module Charges et fiscalité, Étape 1 (2026-09-06, docs/backlog.md,
// section "Suivi des charges et fiscalité"). 7 catégories retenues,
// alignées sur les comptes du Plan Comptable Général qui alimentent le
// tableau VII du formulaire 2072 (annexe 1, revenus fonciers) — pas une
// nomenclature arbitraire, chaque valeur correspond à une ligne du
// formulaire cible de l'Étape 4 (export, non construite ici).
export const depenseCategorieEnum = pgEnum("depense_categorie", [
  "frais_gestion", // comptes 622 + 64
  "assurance", // compte 616
  "reparation_entretien", // compte 615
  "impots_taxes", // compte 63
  "charges_copropriete", // compte 614
  "interets_emprunt", // compte 6611
  "autre"
]);

export const depense = pgTable(
  "depense",
  {
    ...auditColumns,
    categorie: depenseCategorieEnum("categorie").notNull(),
    montant: decimal("montant", { precision: 10, scale: 2 }).notNull(),
    dateDepense: date("date_depense").notNull(),
    // Description saisie manuellement, ou libellé bancaire d'origine tel
    // quel si la dépense vient d'un import CSV (aucune reformulation
    // automatique) — jamais recalculé après création.
    libelle: text("libelle").notNull(),
    // Une dépense se rattache à un bien précis, ou directement à une SCI
    // sans bien identifiable (frais de gestion, comptable) — jamais les
    // deux, jamais aucun des deux (voir depense_rattachement_requis).
    bienId: uuid("bien_id").references(() => bien.id),
    // Module Régularisation des charges, Sous-commit A (2026-09-30) :
    // granularité optionnelle SOUS bienId — une dépense imputable à un
    // logement précis (ex. réparation dans l'appartement 3B), par
    // opposition à une charge commune d'immeuble à répartir manuellement
    // entre plusieurs lots (appartementId absent, bienId seul renseigné).
    // NULL = comportement inchangé (dépense de niveau bien/immeuble ou
    // SCI, comme avant l'introduction de cette colonne). Toujours
    // accompagné d'un bienId cohérent (DepensesService.create dérive
    // bienId depuis appartements.bien_id quand seul appartementId est
    // transmis, et rejette toute incohérence si les deux sont fournis et
    // désignent des biens différents) — voir docs/data-dictionary.md.
    appartementId: uuid("appartement_id").references(() => appartements.id),
    // Module Régularisation des charges, Sous-commit D (2026-10-02) :
    // renseigné UNIQUEMENT sur une dépense enfant créée par la répartition
    // d'une charge commune d'immeuble (DepensesService.
    // repartirDepenseEntreLots) — pointe vers la dépense de niveau bien
    // d'origine. Double rôle : trace (quelle dépense source a produit
    // celle-ci) et garde-fou anti-double-répartition (la présence d'au
    // moins un enfant pour une dépense source donnée bloque toute nouvelle
    // tentative de répartition sur cette même source). FK auto-référentielle
    // sur depense.id : le callback différé est nécessaire ici car `depense`
    // n'est pas encore assigné au moment où ce littéral est construit,
    // seulement au moment où Drizzle invoque le callback.
    depenseSourceId: uuid("depense_source_id").references((): AnyPgColumn => depense.id),
    // Dénormalisé depuis bien.sciId à la création quand bienId est
    // renseigné (jamais résolu à la lecture) : même principe que
    // bien.organisationId, qui n'est pas non plus dérivé à la volée à
    // chaque requête. Sûr ici car bien.sciId est immuable après création
    // (UpdateBienDto ne l'expose pas, vérifié) — aucun risque de
    // désynchronisation entre depense.sciId et bien.sciId au fil du temps.
    // Simplifie les requêtes futures par SCI (Étape 3, dashboard ; Étape 4,
    // export 2072) sans jointure systématique via bien.
    sciId: uuid("sci_id").references(() => scis.id),
    // Scoping multi-tenant direct, même principe que bien.organisationId/
    // tache.organisationId — résolu depuis l'organisation de l'utilisateur
    // courant à la création, jamais transmis par le client.
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id)
  },
  (table) => [
    check("depense_rattachement_requis", sql`${table.bienId} IS NOT NULL OR ${table.sciId} IS NOT NULL`)
  ]
);
