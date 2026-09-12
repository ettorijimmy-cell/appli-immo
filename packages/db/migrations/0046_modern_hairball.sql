CREATE TABLE "annexe1_saisie_manuelle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bien_id" uuid NOT NULL,
	"annee" integer NOT NULL,
	"ligne_2" numeric(10, 2),
	"ligne_3" numeric(10, 2),
	"ligne_4" numeric(10, 2),
	"ligne_9_bis" numeric(10, 2),
	"ligne_10" numeric(10, 2),
	"ligne_11" numeric(10, 2),
	"ligne_14" numeric(10, 2),
	"ligne_15" numeric(10, 2),
	"ligne_19" numeric(10, 2),
	"ligne_20" numeric(10, 2),
	"ligne_22" numeric(10, 2),
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annexe1_saisie_manuelle" ADD CONSTRAINT "annexe1_saisie_manuelle_bien_id_bien_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."bien"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annexe1_saisie_manuelle" ADD CONSTRAINT "annexe1_saisie_manuelle_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "annexe1_saisie_manuelle_bien_annee_unique" ON "annexe1_saisie_manuelle" USING btree ("bien_id","annee");