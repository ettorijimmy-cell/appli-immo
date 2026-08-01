ALTER TABLE "public"."appartements" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."appartement_type";--> statement-breakpoint
CREATE TYPE "public"."appartement_type" AS ENUM('T1', 'T2', 'T3', 'T4', 'T5', 'T6');--> statement-breakpoint
ALTER TABLE "public"."appartements" ALTER COLUMN "type" SET DATA TYPE "public"."appartement_type" USING "type"::"public"."appartement_type";