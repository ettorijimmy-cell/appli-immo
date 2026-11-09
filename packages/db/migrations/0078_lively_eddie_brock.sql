CREATE TYPE "public"."locataire_statut_etudes" AS ENUM('non_renseigne', 'aucun', 'etudiant_boursier', 'etudiant_non_boursier', 'apprenti');--> statement-breakpoint
CREATE TYPE "public"."garant_remise_bail_mode" AS ENUM('main_propre', 'lettre_recommandee', 'courrier_simple', 'email');--> statement-breakpoint
ALTER TYPE "public"."document_categorie" ADD VALUE 'contrat_cautionnement_visale';--> statement-breakpoint
ALTER TYPE "public"."document_categorie" ADD VALUE 'acte_cautionnement_signe';--> statement-breakpoint
CREATE TABLE "garant_remise_bail" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"garant_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"date_remise" date NOT NULL,
	"mode" "garant_remise_bail_mode" NOT NULL,
	"declaree_le" timestamp with time zone NOT NULL,
	"declaree_par" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garants" ALTER COLUMN "prenom" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "locataires" ADD COLUMN "statut_etudes" "locataire_statut_etudes" DEFAULT 'non_renseigne' NOT NULL;--> statement-breakpoint
ALTER TABLE "baux" ADD COLUMN "assurance_loyers_impayes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "numero_contrat_visale" text;--> statement-breakpoint
ALTER TABLE "bail_locataires" ADD COLUMN "date_effet_conge" date;--> statement-breakpoint
ALTER TABLE "garant_remise_bail" ADD CONSTRAINT "garant_remise_bail_garant_id_garants_id_fk" FOREIGN KEY ("garant_id") REFERENCES "public"."garants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garant_remise_bail" ADD CONSTRAINT "garant_remise_bail_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garant_remise_bail" ADD CONSTRAINT "garant_remise_bail_declaree_par_utilisateurs_id_fk" FOREIGN KEY ("declaree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garant_remise_bail_active_unique" ON "garant_remise_bail" USING btree ("garant_id") WHERE "garant_remise_bail"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "garant_remise_bail_historique_idx" ON "garant_remise_bail" USING btree ("garant_id");--> statement-breakpoint
ALTER TABLE "garants" ADD CONSTRAINT "garants_prenom_personne_physique" CHECK ("garants"."type_garantie" <> 'personne_physique' OR "garants"."prenom" IS NOT NULL);--> statement-breakpoint
-- Ajouté à la main, drizzle-kit ne gère pas les triggers. Une déclaration
-- de remise du bail à la caution est une trace : aucune suppression ni
-- vidage possible, quel que soit le code appelant.
CREATE FUNCTION "public"."garant_remise_bail_interdire_suppression"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suppression interdite : garant_remise_bail conserve les déclarations de remise du bail à la caution.'
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "garant_remise_bail_sans_suppression" BEFORE DELETE ON "garant_remise_bail" FOR EACH ROW EXECUTE FUNCTION "public"."garant_remise_bail_interdire_suppression"();--> statement-breakpoint
CREATE TRIGGER "garant_remise_bail_sans_vidage" BEFORE TRUNCATE ON "garant_remise_bail" FOR EACH STATEMENT EXECUTE FUNCTION "public"."garant_remise_bail_interdire_suppression"();--> statement-breakpoint
-- Une correction écrit une nouvelle ligne : une ligne existante ne change
-- jamais, sauf pour être archivée une seule fois (archived_at et les
-- colonnes d'audit qui accompagnent toute écriture).
CREATE FUNCTION "public"."garant_remise_bail_immuable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL
    OR NEW.archived_at IS NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.garant_id IS DISTINCT FROM OLD.garant_id
    OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.date_remise IS DISTINCT FROM OLD.date_remise
    OR NEW.mode IS DISTINCT FROM OLD.mode
    OR NEW.declaree_le IS DISTINCT FROM OLD.declaree_le
    OR NEW.declaree_par IS DISTINCT FROM OLD.declaree_par
  THEN
    RAISE EXCEPTION 'Modification interdite : une déclaration de remise du bail à la caution ne peut qu''être archivée, une seule fois.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "garant_remise_bail_sans_modification" BEFORE UPDATE ON "garant_remise_bail" FOR EACH ROW EXECUTE FUNCTION "public"."garant_remise_bail_immuable"();
