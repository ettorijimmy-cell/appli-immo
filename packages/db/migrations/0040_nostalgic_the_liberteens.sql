CREATE TABLE "revision_loyer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bail_id" uuid NOT NULL,
	"tache_id" uuid,
	"date_effet" date NOT NULL,
	"loyer_avant" numeric(10, 2) NOT NULL,
	"loyer_apres" numeric(10, 2) NOT NULL,
	"trimestre_reference" integer NOT NULL,
	"annee_reference" integer NOT NULL,
	"indice_reference_valeur" numeric(6, 2) NOT NULL,
	"indice_precedent_valeur" numeric(6, 2) NOT NULL,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "baux" ADD COLUMN "trimestre_reference_revision" integer;--> statement-breakpoint
ALTER TABLE "revision_loyer" ADD CONSTRAINT "revision_loyer_bail_id_baux_id_fk" FOREIGN KEY ("bail_id") REFERENCES "public"."baux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_loyer" ADD CONSTRAINT "revision_loyer_tache_id_tache_id_fk" FOREIGN KEY ("tache_id") REFERENCES "public"."tache"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_loyer" ADD CONSTRAINT "revision_loyer_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tache_bail_periode_revision_active_unique" ON "tache" USING btree ("bail_id","periode_recurrence") WHERE "tache"."type" = 'revision_loyer' AND "tache"."statut" IN ('a_faire', 'en_cours') AND "tache"."bail_id" IS NOT NULL AND "tache"."periode_recurrence" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "baux" ADD CONSTRAINT "baux_trimestre_reference_revision_valide" CHECK ("baux"."trimestre_reference_revision" IS NULL OR "baux"."trimestre_reference_revision" BETWEEN 1 AND 4);