CREATE TYPE "public"."document_etat_des_lieux_piece_type" AS ENUM('entree', 'sejour', 'cuisine', 'chambre', 'salle_de_bain', 'wc', 'autre');--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "etat_des_lieux_piece_type" "document_etat_des_lieux_piece_type";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "etat_des_lieux_piece_numero" integer;