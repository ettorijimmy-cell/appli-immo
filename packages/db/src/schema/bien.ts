import { sql } from "drizzle-orm";
import { date, decimal, integer, pgEnum, pgTable, text, uuid, check } from "drizzle-orm/pg-core";
import { auditColumns } from "./columns.helpers";
import { immeubleRegimeJuridiqueEnum, immeubleTypeHabitatEnum } from "./immeubles";
import { organisations } from "./organisations";
import { scis } from "./scis";

// Niveau générique au-dessus d'appartement, introduit pour représenter un
// bien qui n'est pas forcément un immeuble à plusieurs lots (maison, lot de
// copropriété géré seul, parking, bureau, local commercial) ni forcément
// détenu par une SCI (personne physique) — voir docs/backlog.md, migration
// bien (2026-08-25). Un immeuble a N appartements ; tout autre type en a
// exactement 1 (règle applicative, pas une contrainte de schéma).
export const bienTypeEnum = pgEnum("bien_type", [
  "immeuble",
  "maison",
  "appartement_isole",
  "parking",
  "bureau",
  "local_commercial"
]);
export const bienProprietaireTypeEnum = pgEnum("bien_proprietaire_type", ["sci", "personne_physique"]);
export const bienStatutEnum = pgEnum("bien_statut", ["actif", "archive"]);

export const bien = pgTable(
  "bien",
  {
    ...auditColumns,
    type: bienTypeEnum("type").notNull(),
    proprietaireType: bienProprietaireTypeEnum("proprietaire_type").notNull(),
    // Donnée légale/informationnelle uniquement (fiscalité, futur module
    // Charges et fiscalité — déclaration 2072) — jamais le mécanisme de
    // scoping multi-tenant, voir organisationId ci-dessous.
    sciId: uuid("sci_id").references(() => scis.id),
    // Nom du bailleur en nom propre (Module Tâches, Étape 4 — quittance
    // mensuelle, 2026-08-31) : requis exclusivement quand proprietaireType
    // = 'personne_physique' (voir bien_proprietaire_coherent ci-dessous),
    // NULL pour un bien en SCI (le nom du bailleur y est déjà sci.nom).
    // Corrige un trou latent découvert en auditant bail-document-docx
    // .service.ts, qui échouait (NotFoundException) pour tout bien en nom
    // propre faute d'alternative à sci.nom — voir BienService
    // .resoudreNomBailleur.
    nomProprietaire: text("nom_proprietaire"),
    // Clé de scoping multi-tenant réelle, peuplée depuis l'organisation de
    // l'utilisateur courant à la création (même source que
    // organisation_sci.organisation_id pour une SCI) — indépendamment du
    // mode de détention. Un bien en nom propre (proprietaireType=
    // 'personne_physique', sciId NULL) n'a sinon aucun chemin de scoping :
    // le chemin historique organisation_sci -> sci_id -> immeuble ne
    // couvre que les biens en SCI. organisation_sci reste une table
    // purement informationnelle (quelle SCI appartient à quelle
    // organisation), plus le mécanisme de contrôle d'accès pour
    // bien/appartement (docs/backlog.md, migration bien).
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    adresse: text("adresse").notNull(),
    codePostal: text("code_postal").notNull(),
    ville: text("ville").notNull(),
    // Nullable : un libellé n'a de sens obligatoire que pour un immeuble
    // (voir la contrainte bien_nom_requis_si_immeuble ci-dessous). Repli
    // d'affichage partout ailleurs : bien.nom ?? bien.adresse (desktop,
    // mobile-web, command palette, breadcrumb).
    nom: text("nom"),
    // Commun à tout type de bien vis-à-vis du contrat-type de bail (pas
    // réservé aux immeubles) — décision de l'audit du 2026-08-25, corrige
    // l'hypothèse initiale qui le plaçait sur bien_immeuble_detail.
    anneeConstruction: integer("annee_construction"),
    // Déplacés depuis bien_immeuble_detail le 2026-08-26 : caractérisation
    // légale du LOGEMENT (mentions du contrat-type, décret n° 2015-587 —
    // cases à cocher "type d'habitat"/"régime juridique"), jamais une
    // donnée de gestion de copropriété (syndic/nb_lots/
    // charges_copro_annuelles, qui restent eux sur bien_immeuble_detail,
    // sans équivalent pour un bien non-immeuble). BienService.create()
    // dérive automatiquement 'individuel'/'mono_propriete' pour
    // type='maison' (vrai par définition d'une maison individuelle,
    // aucune saisie possible) ; exige une saisie explicite pour tout autre
    // type (immeuble, appartement_isole, parking, bureau,
    // local_commercial — ambigu par nature, ex. un appartement_isole ou un
    // parking peuvent être dans un ensemble collectif en copropriété).
    typeHabitat: immeubleTypeHabitatEnum("type_habitat"),
    regimeJuridique: immeubleRegimeJuridiqueEnum("regime_juridique"),
    dateAcquisition: date("date_acquisition"),
    valeurAcquisition: decimal("valeur_acquisition", { precision: 12, scale: 2 }),
    statut: bienStatutEnum("statut").notNull().default("actif")
  },
  (table) => [
    check(
      "bien_sci_id_coherent",
      sql`(${table.proprietaireType} = 'sci' AND ${table.sciId} IS NOT NULL AND ${table.nomProprietaire} IS NULL) OR (${table.proprietaireType} = 'personne_physique' AND ${table.sciId} IS NULL AND ${table.nomProprietaire} IS NOT NULL)`
    ),
    check("bien_nom_requis_si_immeuble", sql`${table.type} != 'immeuble' OR ${table.nom} IS NOT NULL`)
  ]
);
