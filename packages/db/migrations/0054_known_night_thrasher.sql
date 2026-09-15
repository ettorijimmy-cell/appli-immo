CREATE TYPE "public"."sinistre_statut" AS ENUM('declare', 'expertise_planifiee', 'expertise_realisee', 'indemnise', 'clos');--> statement-breakpoint
CREATE TYPE "public"."sinistre_type" AS ENUM('degat_eaux', 'incendie', 'vol', 'bris_de_glace', 'catastrophe_naturelle', 'autre');--> statement-breakpoint
ALTER TYPE "public"."document_entite_type" ADD VALUE 'sinistre';--> statement-breakpoint
ALTER TYPE "public"."alerte_type" ADD VALUE 'sinistre_stagnation';--> statement-breakpoint
ALTER TYPE "public"."tache_type" ADD VALUE 'sinistre_stagnation' BEFORE 'autre';--> statement-breakpoint
ALTER TYPE "public"."evenement_type" ADD VALUE 'expertise_sinistre' BEFORE 'autre';--> statement-breakpoint
CREATE TABLE "sinistre" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"type" "sinistre_type" NOT NULL,
	"statut" "sinistre_statut" DEFAULT 'declare' NOT NULL,
	"date_changement_statut" timestamp with time zone DEFAULT now() NOT NULL,
	"bien_id" uuid,
	"appartement_id" uuid,
	"contact_assureur_id" uuid,
	"date_declaration" date NOT NULL,
	"description" text,
	"montant_reclame" numeric(10, 2),
	"montant_indemnise" numeric(10, 2),
	"franchise" numeric(10, 2),
	"notes" text,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tache" ADD COLUMN "sinistre_id" uuid;--> statement-breakpoint
ALTER TABLE "evenement_calendrier" ADD COLUMN "sinistre_id" uuid;--> statement-breakpoint
ALTER TABLE "sinistre" ADD CONSTRAINT "sinistre_bien_id_bien_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."bien"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinistre" ADD CONSTRAINT "sinistre_appartement_id_appartements_id_fk" FOREIGN KEY ("appartement_id") REFERENCES "public"."appartements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinistre" ADD CONSTRAINT "sinistre_contact_assureur_id_contact_id_fk" FOREIGN KEY ("contact_assureur_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sinistre" ADD CONSTRAINT "sinistre_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tache" ADD CONSTRAINT "tache_sinistre_id_sinistre_id_fk" FOREIGN KEY ("sinistre_id") REFERENCES "public"."sinistre"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement_calendrier" ADD CONSTRAINT "evenement_calendrier_sinistre_id_sinistre_id_fk" FOREIGN KEY ("sinistre_id") REFERENCES "public"."sinistre"("id") ON DELETE no action ON UPDATE no action;