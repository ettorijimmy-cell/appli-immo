CREATE TYPE "public"."modele_courrier_canal" AS ENUM('email');--> statement-breakpoint
CREATE TABLE "modele_courrier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"code" text NOT NULL,
	"nom" text NOT NULL,
	"canal" "modele_courrier_canal" DEFAULT 'email' NOT NULL,
	"objet" text,
	"corps" text NOT NULL,
	"variables_requises" jsonb NOT NULL,
	"organisation_id" uuid NOT NULL,
	CONSTRAINT "modele_courrier_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "modele_courrier" ADD CONSTRAINT "modele_courrier_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;