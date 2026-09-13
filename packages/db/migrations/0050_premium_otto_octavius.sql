CREATE TYPE "public"."evenement_type" AS ENUM('intervention_artisan', 'visite_candidat', 'etat_des_lieux', 'autre');--> statement-breakpoint
CREATE TABLE "candidat" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"nom" text NOT NULL,
	"telephone" text,
	"email" text,
	"appartement_id" uuid,
	"notes" text,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evenement_calendrier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"type" "evenement_type" NOT NULL,
	"titre" text NOT NULL,
	"date_debut" timestamp with time zone NOT NULL,
	"date_fin" timestamp with time zone,
	"bien_id" uuid,
	"appartement_id" uuid,
	"contact_id" uuid,
	"candidat_id" uuid,
	"notes" text,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendrier_abonnement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"jeton" text NOT NULL,
	"organisation_id" uuid NOT NULL,
	CONSTRAINT "calendrier_abonnement_jeton_unique" UNIQUE("jeton")
);
--> statement-breakpoint
ALTER TABLE "candidat" ADD CONSTRAINT "candidat_appartement_id_appartements_id_fk" FOREIGN KEY ("appartement_id") REFERENCES "public"."appartements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidat" ADD CONSTRAINT "candidat_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement_calendrier" ADD CONSTRAINT "evenement_calendrier_bien_id_bien_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."bien"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement_calendrier" ADD CONSTRAINT "evenement_calendrier_appartement_id_appartements_id_fk" FOREIGN KEY ("appartement_id") REFERENCES "public"."appartements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement_calendrier" ADD CONSTRAINT "evenement_calendrier_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement_calendrier" ADD CONSTRAINT "evenement_calendrier_candidat_id_candidat_id_fk" FOREIGN KEY ("candidat_id") REFERENCES "public"."candidat"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenement_calendrier" ADD CONSTRAINT "evenement_calendrier_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendrier_abonnement" ADD CONSTRAINT "calendrier_abonnement_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendrier_abonnement_organisation_id_unique" ON "calendrier_abonnement" USING btree ("organisation_id");