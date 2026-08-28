CREATE TYPE "public"."tache_origine" AS ENUM('alerte', 'planifiee', 'manuelle');--> statement-breakpoint
CREATE TYPE "public"."tache_statut" AS ENUM('a_faire', 'en_cours', 'fait', 'annulee');--> statement-breakpoint
CREATE TYPE "public"."tache_type" AS ENUM('impaye', 'entretien_equipement', 'document_expire', 'quittance_mensuelle', 'revision_loyer', 'autre');--> statement-breakpoint
CREATE TABLE "tache" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"type" "tache_type" NOT NULL,
	"statut" "tache_statut" DEFAULT 'a_faire' NOT NULL,
	"origine" "tache_origine" NOT NULL,
	"alerte_source_id" uuid,
	"bail_id" uuid,
	"appartement_id" uuid,
	"bien_id" uuid,
	"locataire_id" uuid,
	"date_echeance" date,
	"date_completion" timestamp with time zone,
	"periode_recurrence" text,
	"notes" text,
	"metadata" jsonb,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tache" ADD CONSTRAINT "tache_alerte_source_id_alertes_id_fk" FOREIGN KEY ("alerte_source_id") REFERENCES "public"."alertes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tache" ADD CONSTRAINT "tache_bail_id_baux_id_fk" FOREIGN KEY ("bail_id") REFERENCES "public"."baux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tache" ADD CONSTRAINT "tache_appartement_id_appartements_id_fk" FOREIGN KEY ("appartement_id") REFERENCES "public"."appartements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tache" ADD CONSTRAINT "tache_bien_id_bien_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."bien"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tache" ADD CONSTRAINT "tache_locataire_id_locataires_id_fk" FOREIGN KEY ("locataire_id") REFERENCES "public"."locataires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tache" ADD CONSTRAINT "tache_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tache_alerte_source_active_unique" ON "tache" USING btree ("alerte_source_id") WHERE "tache"."statut" IN ('a_faire', 'en_cours') AND "tache"."alerte_source_id" IS NOT NULL;