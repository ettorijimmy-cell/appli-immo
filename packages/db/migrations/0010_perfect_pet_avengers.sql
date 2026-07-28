ALTER TYPE "public"."alerte_statut" ADD VALUE 'resolue';--> statement-breakpoint
DROP INDEX "alertes_type_entite_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "alertes_type_entite_id_active_unique" ON "alertes" USING btree ("type","entite_id") WHERE "alertes"."statut" = 'active';