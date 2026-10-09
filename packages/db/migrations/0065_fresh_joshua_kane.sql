CREATE TYPE "public"."appartement_classe_dpe" AS ENUM('A', 'B', 'C', 'D', 'E', 'F', 'G');--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "classe_dpe" "appartement_classe_dpe";--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "depenses_energie_min" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "depenses_energie_max" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "annee_reference_prix_energie" integer;