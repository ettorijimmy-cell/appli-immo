CREATE TYPE "public"."candidat_statut" AS ENUM('en_attente', 'valide', 'refuse', 'converti');--> statement-breakpoint
ALTER TYPE "public"."document_entite_type" ADD VALUE 'candidat';--> statement-breakpoint
ALTER TABLE "candidat" ADD COLUMN "statut" "candidat_statut" DEFAULT 'en_attente' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidat" ADD COLUMN "revenu_mensuel_net" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "candidat" ADD COLUMN "loyer_vise" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "candidat" ADD COLUMN "situation_professionnelle" text;--> statement-breakpoint
ALTER TABLE "candidat" ADD COLUMN "garant_nom" text;--> statement-breakpoint
ALTER TABLE "candidat" ADD COLUMN "garant_revenu_mensuel_net" numeric(10, 2);