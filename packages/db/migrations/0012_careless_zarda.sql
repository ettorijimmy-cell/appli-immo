CREATE TYPE "public"."remboursement_type" AS ENUM('trop_percu', 'depot_garantie');--> statement-breakpoint
CREATE TABLE "versements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"paiement_id" uuid NOT NULL,
	"montant" numeric(10, 2) NOT NULL,
	"date_versement" date NOT NULL,
	"mode" "paiement_mode" NOT NULL,
	"reference_rapprochement" text
);
--> statement-breakpoint
CREATE TABLE "remboursements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bail_id" uuid NOT NULL,
	"paiement_id" uuid,
	"type" "remboursement_type" NOT NULL,
	"montant_origine" numeric(10, 2) NOT NULL,
	"montant_rembourse" numeric(10, 2) NOT NULL,
	"commentaire" text,
	"date_remboursement" date NOT NULL,
	"mode" "paiement_mode" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "versements" ADD CONSTRAINT "versements_paiement_id_paiements_id_fk" FOREIGN KEY ("paiement_id") REFERENCES "public"."paiements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remboursements" ADD CONSTRAINT "remboursements_bail_id_baux_id_fk" FOREIGN KEY ("bail_id") REFERENCES "public"."baux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remboursements" ADD CONSTRAINT "remboursements_paiement_id_paiements_id_fk" FOREIGN KEY ("paiement_id") REFERENCES "public"."paiements"("id") ON DELETE no action ON UPDATE no action;