CREATE TYPE "public"."locataire_statut" AS ENUM('actif', 'ancien', 'archive');--> statement-breakpoint
CREATE TYPE "public"."bail_statut" AS ENUM('brouillon', 'actif', 'preavis', 'resilie', 'archive');--> statement-breakpoint
CREATE TYPE "public"."bail_type_bail" AS ENUM('vide', 'meuble');--> statement-breakpoint
CREATE TYPE "public"."garant_type_garantie" AS ENUM('personne_physique', 'garantie_visale', 'autre');--> statement-breakpoint
CREATE TYPE "public"."bail_locataire_role" AS ENUM('titulaire', 'colocataire');--> statement-breakpoint
CREATE TABLE "locataires" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"nom" text NOT NULL,
	"prenom" text NOT NULL,
	"email" text,
	"telephone" text,
	"statut" "locataire_statut" DEFAULT 'actif' NOT NULL,
	"anonymise_le" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "baux" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"appartement_id" uuid NOT NULL,
	"type_bail" "bail_type_bail" NOT NULL,
	"statut" "bail_statut" DEFAULT 'brouillon' NOT NULL,
	"loyer_mensuel" numeric(10, 2),
	"depot_garantie" numeric(10, 2),
	"date_debut" date NOT NULL,
	"date_fin" date
);
--> statement-breakpoint
CREATE TABLE "garants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bail_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"prenom" text NOT NULL,
	"email" text,
	"telephone" text,
	"type_garantie" "garant_type_garantie" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bail_locataires" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bail_id" uuid NOT NULL,
	"locataire_id" uuid NOT NULL,
	"role" "bail_locataire_role" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "baux" ADD CONSTRAINT "baux_appartement_id_appartements_id_fk" FOREIGN KEY ("appartement_id") REFERENCES "public"."appartements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garants" ADD CONSTRAINT "garants_bail_id_baux_id_fk" FOREIGN KEY ("bail_id") REFERENCES "public"."baux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bail_locataires" ADD CONSTRAINT "bail_locataires_bail_id_baux_id_fk" FOREIGN KEY ("bail_id") REFERENCES "public"."baux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bail_locataires" ADD CONSTRAINT "bail_locataires_locataire_id_locataires_id_fk" FOREIGN KEY ("locataire_id") REFERENCES "public"."locataires"("id") ON DELETE no action ON UPDATE no action;