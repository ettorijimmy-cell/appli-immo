CREATE TYPE "public"."bien_proprietaire_type" AS ENUM('sci', 'personne_physique');--> statement-breakpoint
CREATE TYPE "public"."bien_statut" AS ENUM('actif', 'archive');--> statement-breakpoint
CREATE TYPE "public"."bien_type" AS ENUM('immeuble', 'maison', 'appartement_isole', 'parking', 'bureau', 'local_commercial');--> statement-breakpoint
CREATE TABLE "bien" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"type" "bien_type" NOT NULL,
	"proprietaire_type" "bien_proprietaire_type" NOT NULL,
	"sci_id" uuid,
	"organisation_id" uuid NOT NULL,
	"adresse" text NOT NULL,
	"code_postal" text NOT NULL,
	"ville" text NOT NULL,
	"nom" text,
	"annee_construction" integer,
	"date_acquisition" date,
	"valeur_acquisition" numeric(12, 2),
	"statut" "bien_statut" DEFAULT 'actif' NOT NULL,
	CONSTRAINT "bien_sci_id_coherent" CHECK (("bien"."proprietaire_type" = 'sci' AND "bien"."sci_id" IS NOT NULL) OR ("bien"."proprietaire_type" = 'personne_physique' AND "bien"."sci_id" IS NULL)),
	CONSTRAINT "bien_nom_requis_si_immeuble" CHECK ("bien"."type" != 'immeuble' OR "bien"."nom" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "bien_immeuble_detail" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bien_id" uuid NOT NULL,
	"type_habitat" "immeuble_type_habitat",
	"regime_juridique" "immeuble_regime_juridique",
	"syndic" text,
	"nb_lots" integer,
	"charges_copro_annuelles" numeric(10, 2),
	CONSTRAINT "bien_immeuble_detail_bien_id_unique" UNIQUE("bien_id")
);
--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "bien_id" uuid;--> statement-breakpoint
ALTER TABLE "bien" ADD CONSTRAINT "bien_sci_id_scis_id_fk" FOREIGN KEY ("sci_id") REFERENCES "public"."scis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bien" ADD CONSTRAINT "bien_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bien_immeuble_detail" ADD CONSTRAINT "bien_immeuble_detail_bien_id_bien_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."bien"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appartements" ADD CONSTRAINT "appartements_bien_id_bien_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."bien"("id") ON DELETE no action ON UPDATE no action;