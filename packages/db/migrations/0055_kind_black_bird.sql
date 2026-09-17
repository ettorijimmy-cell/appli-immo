CREATE TYPE "public"."message_classification_type" AS ENUM('contact', 'locataire', 'candidat', 'non_classe');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('envoye', 'recu');--> statement-breakpoint
CREATE TABLE "boite_mail_dediee" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"email" text NOT NULL,
	"mot_de_passe_app_chiffre" text NOT NULL,
	"dernier_uid_synchronise" integer,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_communication" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"direction" "message_direction" NOT NULL,
	"objet" text,
	"corps" text,
	"email_expediteur" text NOT NULL,
	"email_destinataire" text NOT NULL,
	"date_message" timestamp with time zone NOT NULL,
	"imap_message_id" text,
	"classification_type" "message_classification_type" DEFAULT 'non_classe' NOT NULL,
	"classification_id" uuid,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "piece_jointe_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"message_id" uuid NOT NULL,
	"nom_fichier" text NOT NULL,
	"chemin_stockage" text NOT NULL,
	"type_mime" text,
	"organisation_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boite_mail_dediee" ADD CONSTRAINT "boite_mail_dediee_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_communication" ADD CONSTRAINT "message_communication_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_jointe_message" ADD CONSTRAINT "piece_jointe_message_message_id_message_communication_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message_communication"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piece_jointe_message" ADD CONSTRAINT "piece_jointe_message_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boite_mail_dediee_organisation_active_unique" ON "boite_mail_dediee" USING btree ("organisation_id") WHERE "boite_mail_dediee"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "message_communication_imap_id_unique" ON "message_communication" USING btree ("organisation_id","imap_message_id") WHERE "message_communication"."imap_message_id" IS NOT NULL;