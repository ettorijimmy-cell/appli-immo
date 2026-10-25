CREATE TYPE "public"."etat_des_lieux_phase" AS ENUM('entree', 'sortie');--> statement-breakpoint
CREATE TYPE "public"."etat_des_lieux_signature_role" AS ENUM('bailleur', 'locataire');--> statement-breakpoint
ALTER TYPE "public"."document_categorie" ADD VALUE 'signature';--> statement-breakpoint
CREATE TABLE "etat_des_lieux_signature" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"phase" "etat_des_lieux_phase" NOT NULL,
	"role" "etat_des_lieux_signature_role" NOT NULL,
	"locataire_id" uuid,
	"nom_affiche" text NOT NULL,
	"document_id" uuid NOT NULL,
	"lu_et_approuve" boolean DEFAULT false NOT NULL,
	"signe_le" timestamp with time zone NOT NULL,
	CONSTRAINT "etat_des_lieux_signature_locataire_coherent" CHECK (("etat_des_lieux_signature"."role" = 'bailleur' AND "etat_des_lieux_signature"."locataire_id" IS NULL) OR ("etat_des_lieux_signature"."role" = 'locataire' AND "etat_des_lieux_signature"."locataire_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "etat_des_lieux_phase" "etat_des_lieux_phase";--> statement-breakpoint
ALTER TABLE "etat_des_lieux_signature" ADD CONSTRAINT "etat_des_lieux_signature_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_signature" ADD CONSTRAINT "etat_des_lieux_signature_locataire_id_locataires_id_fk" FOREIGN KEY ("locataire_id") REFERENCES "public"."locataires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_signature" ADD CONSTRAINT "etat_des_lieux_signature_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_signature_bailleur_phase_unique" ON "etat_des_lieux_signature" USING btree ("etat_des_lieux_id","phase") WHERE "etat_des_lieux_signature"."role" = 'bailleur' AND "etat_des_lieux_signature"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_signature_locataire_phase_unique" ON "etat_des_lieux_signature" USING btree ("etat_des_lieux_id","phase","locataire_id") WHERE "etat_des_lieux_signature"."role" = 'locataire' AND "etat_des_lieux_signature"."archived_at" IS NULL;