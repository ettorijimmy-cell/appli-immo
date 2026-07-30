CREATE TYPE "public"."immeuble_regime_juridique" AS ENUM('mono_propriete', 'copropriete');--> statement-breakpoint
CREATE TYPE "public"."immeuble_type_habitat" AS ENUM('collectif', 'individuel');--> statement-breakpoint
CREATE TYPE "public"."appartement_mode_production" AS ENUM('individuel', 'collectif');--> statement-breakpoint
CREATE TYPE "public"."diagnostic_classe_dpe" AS ENUM('A', 'B', 'C', 'D', 'E', 'F', 'G');--> statement-breakpoint
CREATE TYPE "public"."diagnostic_type" AS ENUM('dpe', 'crep_plomb', 'erp');--> statement-breakpoint
CREATE TABLE "diagnostics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"document_id" uuid NOT NULL,
	"type" "diagnostic_type" NOT NULL,
	"classe_dpe" "diagnostic_classe_dpe",
	"depenses_theoriques_chauffage" numeric(10, 2),
	"risque_present" boolean
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "adresse" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "code_postal" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "ville" text;--> statement-breakpoint
ALTER TABLE "scis" ADD COLUMN "adresse" text;--> statement-breakpoint
ALTER TABLE "scis" ADD COLUMN "code_postal" text;--> statement-breakpoint
ALTER TABLE "scis" ADD COLUMN "ville" text;--> statement-breakpoint
ALTER TABLE "scis" ADD COLUMN "nom_gerant" text;--> statement-breakpoint
ALTER TABLE "scis" ADD COLUMN "prenom_gerant" text;--> statement-breakpoint
ALTER TABLE "immeubles" ADD COLUMN "type_habitat" "immeuble_type_habitat";--> statement-breakpoint
ALTER TABLE "immeubles" ADD COLUMN "regime_juridique" "immeuble_regime_juridique";--> statement-breakpoint
ALTER TABLE "immeubles" ADD COLUMN "annee_construction" integer;--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "identifiant_fiscal" text;--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "nombre_pieces_principales" integer;--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "mode_chauffage" "appartement_mode_production";--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "mode_eau_chaude" "appartement_mode_production";--> statement-breakpoint
ALTER TABLE "baux" ADD COLUMN "travaux_realises" text;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "adresse" text;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "code_postal" text;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "ville" text;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "profession" text;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "revenus" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;