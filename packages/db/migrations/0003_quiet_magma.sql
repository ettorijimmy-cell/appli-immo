CREATE TYPE "public"."immeuble_statut" AS ENUM('actif', 'archive');--> statement-breakpoint
CREATE TYPE "public"."appartement_statut" AS ENUM('vacant', 'loue', 'travaux', 'archive');--> statement-breakpoint
CREATE TYPE "public"."appartement_type" AS ENUM('T1', 'T2', 'T3', 'T4', 'T5+');--> statement-breakpoint
CREATE TYPE "public"."equipement_type" AS ENUM('chaudiere', 'ballon_eau_chaude', 'autre');--> statement-breakpoint
CREATE TABLE "immeubles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"sci_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"adresse" text NOT NULL,
	"code_postal" text,
	"ville" text,
	"statut" "immeuble_statut" DEFAULT 'actif' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appartements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"immeuble_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"type" "appartement_type" NOT NULL,
	"surface" numeric(6, 2),
	"loyer_reference" numeric(10, 2),
	"statut" "appartement_statut" DEFAULT 'vacant' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"appartement_id" uuid NOT NULL,
	"type" "equipement_type" NOT NULL,
	"date_dernier_entretien" date
);
--> statement-breakpoint
ALTER TABLE "immeubles" ADD CONSTRAINT "immeubles_sci_id_scis_id_fk" FOREIGN KEY ("sci_id") REFERENCES "public"."scis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appartements" ADD CONSTRAINT "appartements_immeuble_id_immeubles_id_fk" FOREIGN KEY ("immeuble_id") REFERENCES "public"."immeubles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipements" ADD CONSTRAINT "equipements_appartement_id_appartements_id_fk" FOREIGN KEY ("appartement_id") REFERENCES "public"."appartements"("id") ON DELETE no action ON UPDATE no action;