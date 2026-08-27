ALTER TABLE "immeubles" RENAME TO "immeubles_legacy";--> statement-breakpoint
ALTER TABLE "immeubles_legacy" DROP CONSTRAINT "immeubles_sci_id_scis_id_fk";
--> statement-breakpoint
ALTER TABLE "immeubles_legacy" ADD CONSTRAINT "immeubles_legacy_sci_id_scis_id_fk" FOREIGN KEY ("sci_id") REFERENCES "public"."scis"("id") ON DELETE no action ON UPDATE no action;