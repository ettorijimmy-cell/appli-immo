ALTER TABLE "locataires" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "garants" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "locataires" ADD CONSTRAINT "locataires_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garants" ADD CONSTRAINT "garants_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;