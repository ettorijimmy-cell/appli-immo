CREATE TYPE "public"."remboursement_motif_retenue" AS ENUM('degradation_locative', 'reparations_locatives_non_effectuees', 'charges_impayees', 'loyers_impayes', 'autre');--> statement-breakpoint
ALTER TABLE "remboursements" ADD COLUMN "motif_retenue" "remboursement_motif_retenue";--> statement-breakpoint
ALTER TABLE "remboursements" ADD COLUMN "piece_justificative_chemin" text;--> statement-breakpoint
ALTER TABLE "remboursements" ADD COLUMN "piece_justificative_nom_fichier" text;--> statement-breakpoint
ALTER TABLE "remboursements" ADD COLUMN "piece_justificative_mime_type" text;--> statement-breakpoint
ALTER TABLE "remboursements" ADD COLUMN "piece_justificative_taille_octets" integer;