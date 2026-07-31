ALTER TABLE "scis" ADD COLUMN "telephone" text;--> statement-breakpoint
ALTER TABLE "scis" ADD COLUMN "est_familiale" boolean;--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "equipement_cuisine" text;--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "dependances_annexes" text;--> statement-breakpoint
ALTER TABLE "locataires" ADD COLUMN "adresse" text;--> statement-breakpoint
ALTER TABLE "locataires" ADD COLUMN "code_postal" text;--> statement-breakpoint
ALTER TABLE "locataires" ADD COLUMN "ville" text;--> statement-breakpoint
ALTER TABLE "locataires" ADD COLUMN "date_naissance" date;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "date_naissance" date;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "lieu_naissance" text;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "nationalite" text;