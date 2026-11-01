CREATE TYPE "public"."etat_des_lieux_envoi_statut" AS ENUM('en_cours', 'envoye', 'echec', 'indetermine');--> statement-breakpoint
CREATE TABLE "etat_des_lieux_envoi" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"phase" "etat_des_lieux_phase" NOT NULL,
	"locataire_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"pdf_sha256" text NOT NULL,
	"demande_id" uuid NOT NULL,
	"nom_destinataire" text NOT NULL,
	"adresse_utilisee" text NOT NULL,
	"adresse_expediteur" text,
	"objet" text NOT NULL,
	"statut" "etat_des_lieux_envoi_statut" DEFAULT 'en_cours' NOT NULL,
	"tente_le" timestamp with time zone NOT NULL,
	"envoye_le" timestamp with time zone,
	"smtp_message_id" text,
	"smtp_reponse" text,
	"code_erreur" text,
	"message_erreur" text,
	"message_communication_id" uuid,
	"organisation_id" uuid NOT NULL,
	CONSTRAINT "etat_des_lieux_envoi_envoye_coherent" CHECK (("etat_des_lieux_envoi"."statut" = 'envoye') = ("etat_des_lieux_envoi"."envoye_le" IS NOT NULL)),
	CONSTRAINT "etat_des_lieux_envoi_echec_coherent" CHECK ("etat_des_lieux_envoi"."statut" <> 'echec' OR "etat_des_lieux_envoi"."code_erreur" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "etat_des_lieux_envoi" ADD CONSTRAINT "etat_des_lieux_envoi_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_envoi" ADD CONSTRAINT "etat_des_lieux_envoi_locataire_id_locataires_id_fk" FOREIGN KEY ("locataire_id") REFERENCES "public"."locataires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_envoi" ADD CONSTRAINT "etat_des_lieux_envoi_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_envoi" ADD CONSTRAINT "etat_des_lieux_envoi_message_communication_id_message_communication_id_fk" FOREIGN KEY ("message_communication_id") REFERENCES "public"."message_communication"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_envoi" ADD CONSTRAINT "etat_des_lieux_envoi_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_envoi_demande_unique" ON "etat_des_lieux_envoi" USING btree ("demande_id","locataire_id");--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_envoi_en_cours_unique" ON "etat_des_lieux_envoi" USING btree ("etat_des_lieux_id","phase","locataire_id") WHERE "etat_des_lieux_envoi"."statut" = 'en_cours';--> statement-breakpoint
CREATE INDEX "etat_des_lieux_envoi_historique_idx" ON "etat_des_lieux_envoi" USING btree ("etat_des_lieux_id","phase");--> statement-breakpoint
-- Ajouté à la main, drizzle-kit ne gère pas les triggers. Preuve de remise :
-- aucune suppression possible, quel que soit le code appelant. UPDATE reste
-- permis (statut final, future anonymisation RGPD).
CREATE FUNCTION "public"."etat_des_lieux_envoi_interdire_suppression"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suppression interdite : etat_des_lieux_envoi conserve la preuve de remise.'
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "etat_des_lieux_envoi_sans_suppression" BEFORE DELETE ON "etat_des_lieux_envoi" FOR EACH ROW EXECUTE FUNCTION "public"."etat_des_lieux_envoi_interdire_suppression"();--> statement-breakpoint
CREATE TRIGGER "etat_des_lieux_envoi_sans_vidage" BEFORE TRUNCATE ON "etat_des_lieux_envoi" FOR EACH STATEMENT EXECUTE FUNCTION "public"."etat_des_lieux_envoi_interdire_suppression"();
