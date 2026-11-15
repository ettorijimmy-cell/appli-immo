CREATE TYPE "public"."preavis_auteur" AS ENUM('locataire', 'bailleur');--> statement-breakpoint
CREATE TYPE "public"."preavis_mode_remise" AS ENUM('lrar', 'commissaire_justice', 'main_propre');--> statement-breakpoint
CREATE TYPE "public"."preavis_motif_fin" AS ENUM('corrige', 'annule', 'resilie');--> statement-breakpoint
CREATE TYPE "public"."preavis_motif_reduit" AS ENUM('zone_tendue', 'premier_emploi', 'mutation', 'perte_emploi', 'nouvel_emploi_apres_perte', 'sante', 'violences', 'rsa_aah', 'logement_social');--> statement-breakpoint
CREATE TABLE "bail_preavis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bail_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"auteur" "preavis_auteur" NOT NULL,
	"date_reception" date NOT NULL,
	"mode_remise" "preavis_mode_remise",
	"duree_mois" integer NOT NULL,
	"motif_reduit" "preavis_motif_reduit",
	"date_fin_proposee" date NOT NULL,
	"date_fin" date NOT NULL,
	"date_fin_bail_avant" date,
	"motif_fin" "preavis_motif_fin",
	"declaree_le" timestamp with time zone NOT NULL,
	"declaree_par" uuid NOT NULL,
	CONSTRAINT "bail_preavis_duree_mois" CHECK ("bail_preavis"."duree_mois" BETWEEN 1 AND 6),
	CONSTRAINT "bail_preavis_date_fin_apres_reception" CHECK ("bail_preavis"."date_fin" >= "bail_preavis"."date_reception"),
	CONSTRAINT "bail_preavis_motif_reduit_locataire" CHECK ("bail_preavis"."auteur" <> 'bailleur' OR "bail_preavis"."motif_reduit" IS NULL),
	CONSTRAINT "bail_preavis_archivage_coherent" CHECK (("bail_preavis"."archived_at" IS NULL) = ("bail_preavis"."motif_fin" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "bail_preavis" ADD CONSTRAINT "bail_preavis_bail_id_baux_id_fk" FOREIGN KEY ("bail_id") REFERENCES "public"."baux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bail_preavis" ADD CONSTRAINT "bail_preavis_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bail_preavis" ADD CONSTRAINT "bail_preavis_declaree_par_utilisateurs_id_fk" FOREIGN KEY ("declaree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bail_preavis_actif_unique" ON "bail_preavis" USING btree ("bail_id") WHERE "bail_preavis"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "bail_preavis_historique_idx" ON "bail_preavis" USING btree ("bail_id");--> statement-breakpoint
-- Ajouté à la main, drizzle-kit ne gère pas les triggers. Un préavis est
-- un acte juridique daté, son historique sert de preuve : aucune
-- suppression ni vidage possible, quel que soit le code appelant.
CREATE FUNCTION "public"."bail_preavis_interdire_suppression"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suppression interdite : bail_preavis conserve l''historique des préavis.'
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "bail_preavis_sans_suppression" BEFORE DELETE ON "bail_preavis" FOR EACH ROW EXECUTE FUNCTION "public"."bail_preavis_interdire_suppression"();--> statement-breakpoint
CREATE TRIGGER "bail_preavis_sans_vidage" BEFORE TRUNCATE ON "bail_preavis" FOR EACH STATEMENT EXECUTE FUNCTION "public"."bail_preavis_interdire_suppression"();--> statement-breakpoint
-- Une correction écrit une nouvelle ligne : une ligne existante ne change
-- jamais, sauf pour être archivée une seule fois (archived_at et motif_fin,
-- posés ensemble par la CHECK bail_preavis_archivage_coherent, et les
-- colonnes d'audit qui accompagnent toute écriture).
CREATE FUNCTION "public"."bail_preavis_immuable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL
    OR NEW.archived_at IS NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.bail_id IS DISTINCT FROM OLD.bail_id
    OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
    OR NEW.auteur IS DISTINCT FROM OLD.auteur
    OR NEW.date_reception IS DISTINCT FROM OLD.date_reception
    OR NEW.mode_remise IS DISTINCT FROM OLD.mode_remise
    OR NEW.duree_mois IS DISTINCT FROM OLD.duree_mois
    OR NEW.motif_reduit IS DISTINCT FROM OLD.motif_reduit
    OR NEW.date_fin_proposee IS DISTINCT FROM OLD.date_fin_proposee
    OR NEW.date_fin IS DISTINCT FROM OLD.date_fin
    OR NEW.date_fin_bail_avant IS DISTINCT FROM OLD.date_fin_bail_avant
    OR NEW.declaree_le IS DISTINCT FROM OLD.declaree_le
    OR NEW.declaree_par IS DISTINCT FROM OLD.declaree_par
  THEN
    RAISE EXCEPTION 'Modification interdite : un préavis ne peut qu''être archivé, une seule fois.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "bail_preavis_sans_modification" BEFORE UPDATE ON "bail_preavis" FOR EACH ROW EXECUTE FUNCTION "public"."bail_preavis_immuable"();
