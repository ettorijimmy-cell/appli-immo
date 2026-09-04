CREATE TABLE "connexion_gmail" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"organisation_id" uuid NOT NULL,
	"email_compte" text NOT NULL,
	"access_token_chiffre" text NOT NULL,
	"refresh_token_chiffre" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connexion_gmail" ADD CONSTRAINT "connexion_gmail_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connexion_gmail_organisation_active_unique" ON "connexion_gmail" USING btree ("organisation_id") WHERE "connexion_gmail"."archived_at" IS NULL;