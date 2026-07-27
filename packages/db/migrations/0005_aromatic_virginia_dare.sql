CREATE TYPE "public"."paiement_mode" AS ENUM('virement', 'cheque', 'especes', 'caf');--> statement-breakpoint
CREATE TYPE "public"."paiement_statut" AS ENUM('paye', 'impaye', 'partiel');--> statement-breakpoint
CREATE TYPE "public"."paiement_type" AS ENUM('loyer', 'charges', 'depot_garantie');--> statement-breakpoint
CREATE TABLE "paiements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bail_id" uuid NOT NULL,
	"type" "paiement_type" NOT NULL,
	"mode" "paiement_mode",
	"statut" "paiement_statut" DEFAULT 'impaye' NOT NULL,
	"montant" numeric(10, 2) NOT NULL,
	"montant_paye" numeric(10, 2),
	"date_echeance" date NOT NULL,
	"date_paiement" date,
	"reference_rapprochement" text
);
--> statement-breakpoint
ALTER TABLE "paiements" ADD CONSTRAINT "paiements_bail_id_baux_id_fk" FOREIGN KEY ("bail_id") REFERENCES "public"."baux"("id") ON DELETE no action ON UPDATE no action;