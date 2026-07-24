CREATE TYPE "public"."sci_regime_fiscal" AS ENUM('IS', 'IR');--> statement-breakpoint
CREATE TYPE "public"."sci_statut" AS ENUM('active', 'archive');--> statement-breakpoint
CREATE TABLE "scis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"nom" text NOT NULL,
	"regime_fiscal" "sci_regime_fiscal" NOT NULL,
	"forme_juridique" text,
	"siret" text,
	"statut" "sci_statut" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comptes_bancaires_sci" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"sci_id" uuid NOT NULL,
	"iban_chiffre" text NOT NULL,
	"bic_chiffre" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comptes_bancaires_sci" ADD CONSTRAINT "comptes_bancaires_sci_sci_id_scis_id_fk" FOREIGN KEY ("sci_id") REFERENCES "public"."scis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_sci" ADD CONSTRAINT "organisation_sci_sci_id_scis_id_fk" FOREIGN KEY ("sci_id") REFERENCES "public"."scis"("id") ON DELETE no action ON UPDATE no action;