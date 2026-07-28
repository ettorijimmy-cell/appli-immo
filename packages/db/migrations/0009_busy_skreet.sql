CREATE TYPE "public"."alerte_statut" AS ENUM('active', 'traitee', 'ignoree');--> statement-breakpoint
CREATE TYPE "public"."alerte_type" AS ENUM('bail_fin_proche', 'document_expire', 'document_expire_proche', 'entretien_equipement', 'impaye');--> statement-breakpoint
CREATE TABLE "alertes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"type" "alerte_type" NOT NULL,
	"entite_id" uuid NOT NULL,
	"statut" "alerte_statut" DEFAULT 'active' NOT NULL,
	"message" text NOT NULL,
	"date_reference" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parametres_alertes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"type" "alerte_type" NOT NULL,
	"seuil_jours_avant" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipements" ADD COLUMN "intervalle_entretien_mois" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "alertes_type_entite_id_unique" ON "alertes" USING btree ("type","entite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parametres_alertes_type_unique" ON "parametres_alertes" USING btree ("type");