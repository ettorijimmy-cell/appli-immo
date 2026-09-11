CREATE TABLE "regle_categorisation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"mot_cle" text NOT NULL,
	"categorie" "depense_categorie" NOT NULL,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regle_categorisation" ADD CONSTRAINT "regle_categorisation_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;