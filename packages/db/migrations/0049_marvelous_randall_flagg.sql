CREATE TYPE "public"."contact_role" AS ENUM('artisan', 'diagnostiqueur', 'syndic', 'assureur', 'autre');--> statement-breakpoint
CREATE TYPE "public"."contact_type_entite" AS ENUM('personne_physique', 'entreprise');--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"nom" text NOT NULL,
	"type_entite" "contact_type_entite" NOT NULL,
	"role" "contact_role" NOT NULL,
	"telephone" text,
	"email" text,
	"notes" text,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;