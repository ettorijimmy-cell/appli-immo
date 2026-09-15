import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appartements } from "./appartements";
import { bien } from "./bien";
import { candidat } from "./candidat";
import { auditColumns } from "./columns.helpers";
import { contact } from "./contact";
import { organisations } from "./organisations";
import { sinistre } from "./sinistre";

// Module Calendrier d'interventions (2026-09-15).
export const evenementTypeEnum = pgEnum("evenement_type", [
  "intervention_artisan",
  "visite_candidat",
  "etat_des_lieux",
  // Rendez-vous d'expertise d'un sinistre (Module Suivi sinistre et
  // assurance, 2026-09-16) — voir sinistreId ci-dessous.
  "expertise_sinistre",
  "autre"
]);

// Saisie manuelle indépendante pour cette première version — aucune
// génération automatique depuis etats_des_lieux (qui n'a pas de notion de
// date planifiée à ce jour, seulement dateEntree/dateSortie constatées a
// posteriori). bienId et appartementId sont deux rattachements optionnels
// INDÉPENDANTS (un événement peut concerner tout un bien — ex. travaux de
// toiture — sans viser un appartement précis) ; contactId/candidatId
// couvrent respectivement intervention_artisan/visite_candidat, mais ne
// sont jamais imposés au niveau du schéma (une contrainte applicative
// plus stricte serait prématurée tant que le besoin réel n'a pas montré
// de contre-exemple).
export const evenementCalendrier = pgTable("evenement_calendrier", {
  ...auditColumns,
  type: evenementTypeEnum("type").notNull(),
  titre: text("titre").notNull(),
  dateDebut: timestamp("date_debut", { withTimezone: true }).notNull(),
  dateFin: timestamp("date_fin", { withTimezone: true }),
  bienId: uuid("bien_id").references(() => bien.id),
  appartementId: uuid("appartement_id").references(() => appartements.id),
  contactId: uuid("contact_id").references(() => contact.id),
  candidatId: uuid("candidat_id").references(() => candidat.id),
  // Rattachement optionnel indépendant, même principe que les 4
  // précédents (Module Suivi sinistre et assurance, 2026-09-16) — couvre
  // type='expertise_sinistre' sans être imposé au niveau du schéma.
  sinistreId: uuid("sinistre_id").references(() => sinistre.id),
  notes: text("notes"),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id)
});
