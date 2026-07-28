CREATE TYPE "public"."document_categorie" AS ENUM('bail', 'assurance', 'etat_des_lieux', 'diagnostic', 'dpe', 'piece_identite', 'rib', 'caf', 'quittance', 'courrier', 'photo');--> statement-breakpoint
CREATE TYPE "public"."document_entite_type" AS ENUM('sci', 'immeuble', 'appartement', 'locataire', 'bail');--> statement-breakpoint
CREATE TYPE "public"."document_statut" AS ENUM('valide', 'expire', 'archive');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"entite_type" "document_entite_type" NOT NULL,
	"entite_id" uuid NOT NULL,
	"categorie" "document_categorie" NOT NULL,
	"statut" "document_statut" DEFAULT 'valide' NOT NULL,
	"date_expiration" date,
	"nom_fichier" text NOT NULL,
	"mime_type" text NOT NULL,
	"taille_octets" integer NOT NULL,
	"chemin_stockage" text NOT NULL
);
