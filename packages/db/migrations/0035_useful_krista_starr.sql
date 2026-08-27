ALTER TABLE "appartements" DROP CONSTRAINT "appartements_immeuble_id_immeubles_id_fk";
--> statement-breakpoint
ALTER TABLE "appartements" ALTER COLUMN "bien_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "appartements" DROP COLUMN "immeuble_id";