CREATE TYPE "public"."depense_categorie" AS ENUM('frais_gestion', 'assurance', 'reparation_entretien', 'impots_taxes', 'charges_copropriete', 'interets_emprunt', 'autre');--> statement-breakpoint
ALTER TYPE "public"."document_entite_type" ADD VALUE 'depense';--> statement-breakpoint
CREATE TABLE "depense" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"categorie" "depense_categorie" NOT NULL,
	"montant" numeric(10, 2) NOT NULL,
	"date_depense" date NOT NULL,
	"libelle" text NOT NULL,
	"bien_id" uuid,
	"sci_id" uuid,
	"organisation_id" uuid NOT NULL,
	CONSTRAINT "depense_rattachement_requis" CHECK ("depense"."bien_id" IS NOT NULL OR "depense"."sci_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "depense" ADD CONSTRAINT "depense_bien_id_bien_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."bien"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depense" ADD CONSTRAINT "depense_sci_id_scis_id_fk" FOREIGN KEY ("sci_id") REFERENCES "public"."scis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depense" ADD CONSTRAINT "depense_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;