CREATE TYPE "public"."organisation_statut" AS ENUM('actif', 'archive');--> statement-breakpoint
CREATE TYPE "public"."organisation_type" AS ENUM('particulier', 'syndic');--> statement-breakpoint
CREATE TYPE "public"."organisation_sci_role" AS ENUM('proprietaire', 'mandataire');--> statement-breakpoint
CREATE TYPE "public"."utilisateur_statut" AS ENUM('actif', 'archive');--> statement-breakpoint
CREATE TYPE "public"."journal_audit_action" AS ENUM('creation', 'modification', 'archivage');--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"type" "organisation_type" NOT NULL,
	"nom" text NOT NULL,
	"email_contact" text,
	"statut" "organisation_statut" DEFAULT 'actif' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_sci" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"organisation_id" uuid NOT NULL,
	"sci_id" uuid NOT NULL,
	"role" "organisation_sci_role" NOT NULL,
	"date_debut" date NOT NULL,
	"date_fin" date
);
--> statement-breakpoint
CREATE TABLE "utilisateurs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"nom" text NOT NULL,
	"prenom" text NOT NULL,
	"mot_de_passe_hash" text NOT NULL,
	"statut" "utilisateur_statut" DEFAULT 'actif' NOT NULL,
	CONSTRAINT "utilisateurs_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "journal_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entite_type" text NOT NULL,
	"entite_id" uuid,
	"action" "journal_audit_action" NOT NULL,
	"donnees_avant" jsonb,
	"donnees_apres" jsonb,
	"utilisateur_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisation_sci" ADD CONSTRAINT "organisation_sci_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utilisateurs" ADD CONSTRAINT "utilisateurs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_audit" ADD CONSTRAINT "journal_audit_utilisateur_id_utilisateurs_id_fk" FOREIGN KEY ("utilisateur_id") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;