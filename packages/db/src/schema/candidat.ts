import { decimal, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { appartements } from "./appartements";
import { auditColumns } from "./columns.helpers";
import { organisations } from "./organisations";

// Module Calendrier d'interventions (2026-09-15). Un candidat (prospect
// visitant un logement, pas encore locataire) est une entité SÉPARÉE de
// `contact` (Carnet de contacts) — décision actée avec Jimmy : un candidat
// a besoin d'être rattaché à un appartement précis, ce que `contact`
// exclut explicitement par conception (un contact professionnel n'est
// jamais lié à un bien). Jamais fusionné avec `locataires` non plus : un
// candidat n'a pas de bail, la conversion en locataire reste un acte
// manuel (création d'un locataire à part, aucune migration automatique
// candidat -> locataire à cette étape).
//
// Candidats devient son propre module de navigation (2026-09-15, décision
// révisée en cours de conception) — anticipation du futur portail externe
// de dépôt de dossier (docs/backlog.md, "Portail externe") qui aura besoin
// d'une base candidat déjà solide, pas d'une simple sous-entité du
// Calendrier. Le Calendrier référence un candidat (evenement_calendrier.
// candidatId) sans posséder son cycle de vie.
export const candidatStatutEnum = pgEnum("candidat_statut", ["en_attente", "valide", "refuse", "converti"]);

export const candidat = pgTable("candidat", {
  ...auditColumns,
  nom: text("nom").notNull(),
  telephone: text("telephone"),
  email: text("email"),
  appartementId: uuid("appartement_id").references(() => appartements.id),
  notes: text("notes"),
  statut: candidatStatutEnum("statut").notNull().default("en_attente"),
  // Montants en decimal(10,2), même convention que paiements.montant —
  // jamais de flottant, conversion en centimes via montantEnCentimes
  // (packages/core) au moment du calcul (voir calculerTauxEffort).
  revenuMensuelNet: decimal("revenu_mensuel_net", { precision: 10, scale: 2 }),
  // Pré-rempli depuis appartement.loyerReference si disponible au moment
  // de la création du candidat, modifiable ensuite — jamais recalculé
  // automatiquement si le loyer de référence de l'appartement change.
  loyerVise: decimal("loyer_vise", { precision: 10, scale: 2 }),
  situationProfessionnelle: text("situation_professionnelle"),
  garantNom: text("garant_nom"),
  garantRevenuMensuelNet: decimal("garant_revenu_mensuel_net", { precision: 10, scale: 2 }),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id)
});
