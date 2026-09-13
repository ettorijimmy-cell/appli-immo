CREATE TYPE "public"."document_candidat_role" AS ENUM('candidat', 'garant');--> statement-breakpoint
ALTER TYPE "public"."document_categorie" ADD VALUE 'fiche_de_paie';--> statement-breakpoint
ALTER TYPE "public"."document_categorie" ADD VALUE 'contrat_travail';--> statement-breakpoint
ALTER TYPE "public"."document_categorie" ADD VALUE 'avis_imposition';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "candidat_role" "document_candidat_role";