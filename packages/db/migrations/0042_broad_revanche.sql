ALTER TABLE "bien" DROP CONSTRAINT "bien_sci_id_coherent";--> statement-breakpoint
ALTER TABLE "bien" ADD COLUMN "nom_proprietaire" text;--> statement-breakpoint
ALTER TABLE "paiements" ADD COLUMN "loyer_hors_charges" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "paiements" ADD COLUMN "charges" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "tache" ADD COLUMN "paiement_id" uuid;--> statement-breakpoint
ALTER TABLE "tache" ADD CONSTRAINT "tache_paiement_id_paiements_id_fk" FOREIGN KEY ("paiement_id") REFERENCES "public"."paiements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tache_paiement_active_unique" ON "tache" USING btree ("paiement_id") WHERE "tache"."statut" IN ('a_faire', 'en_cours') AND "tache"."paiement_id" IS NOT NULL;--> statement-breakpoint
UPDATE "bien" SET "nom_proprietaire" = 'TEST — 2 rue carnot' WHERE "id" = '01a04418-ab17-7a65-841e-0ed05c3abfff';--> statement-breakpoint
UPDATE "bien" SET "nom_proprietaire" = 'TEST — 28 rue zeubi' WHERE "id" = '01a04419-b239-723a-a4aa-b1612d3957f2';--> statement-breakpoint
ALTER TABLE "bien" ADD CONSTRAINT "bien_sci_id_coherent" CHECK (("bien"."proprietaire_type" = 'sci' AND "bien"."sci_id" IS NOT NULL AND "bien"."nom_proprietaire" IS NULL) OR ("bien"."proprietaire_type" = 'personne_physique' AND "bien"."sci_id" IS NULL AND "bien"."nom_proprietaire" IS NOT NULL));