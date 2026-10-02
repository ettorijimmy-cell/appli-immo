CREATE TYPE "public"."sens_bilan_regularisation" AS ENUM('faveur_locataire', 'faveur_proprietaire', 'equilibre');--> statement-breakpoint
CREATE TABLE "bilan_regularisation_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bail_id" uuid NOT NULL,
	"periode_debut" date NOT NULL,
	"periode_fin" date NOT NULL,
	"provisions_recues" numeric(10, 2) NOT NULL,
	"charges_reelles" numeric(10, 2) NOT NULL,
	"solde" numeric(10, 2) NOT NULL,
	"sens" "sens_bilan_regularisation" NOT NULL,
	"tache_id" uuid,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bilan_regularisation_charges" ADD CONSTRAINT "bilan_regularisation_charges_bail_id_baux_id_fk" FOREIGN KEY ("bail_id") REFERENCES "public"."baux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bilan_regularisation_charges" ADD CONSTRAINT "bilan_regularisation_charges_tache_id_tache_id_fk" FOREIGN KEY ("tache_id") REFERENCES "public"."tache"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bilan_regularisation_charges" ADD CONSTRAINT "bilan_regularisation_charges_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;