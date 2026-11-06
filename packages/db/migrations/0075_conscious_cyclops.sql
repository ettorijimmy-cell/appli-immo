ALTER TYPE "public"."document_categorie" ADD VALUE 'etat_des_lieux_entree_papier';--> statement-breakpoint
CREATE TABLE "etat_des_lieux_entree_papier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"date_signature" date NOT NULL,
	"lieu" text NOT NULL,
	"document_id" uuid NOT NULL,
	"signataires" jsonb NOT NULL,
	"declaree_le" timestamp with time zone NOT NULL,
	"declaree_par" uuid NOT NULL,
	CONSTRAINT "etat_des_lieux_entree_papier_lieu_non_vide" CHECK (btrim("etat_des_lieux_entree_papier"."lieu") <> ''),
	CONSTRAINT "etat_des_lieux_entree_papier_signataires_coherent" CHECK (jsonb_typeof("etat_des_lieux_entree_papier"."signataires") = 'array' AND jsonb_array_length("etat_des_lieux_entree_papier"."signataires") >= 2)
);
--> statement-breakpoint
ALTER TABLE "etat_des_lieux_entree_papier" ADD CONSTRAINT "etat_des_lieux_entree_papier_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_entree_papier" ADD CONSTRAINT "etat_des_lieux_entree_papier_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_entree_papier" ADD CONSTRAINT "etat_des_lieux_entree_papier_declaree_par_utilisateurs_id_fk" FOREIGN KEY ("declaree_par") REFERENCES "public"."utilisateurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_entree_papier_active_unique" ON "etat_des_lieux_entree_papier" USING btree ("etat_des_lieux_id") WHERE "etat_des_lieux_entree_papier"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "etat_des_lieux_entree_papier_historique_idx" ON "etat_des_lieux_entree_papier" USING btree ("etat_des_lieux_id");--> statement-breakpoint
-- Ajouté à la main, drizzle-kit ne gère pas les triggers. Une déclaration
-- d'entrée papier est une pièce à valeur légale : aucune suppression ni
-- vidage possible, quel que soit le code appelant.
CREATE FUNCTION "public"."etat_des_lieux_entree_papier_interdire_suppression"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suppression interdite : etat_des_lieux_entree_papier conserve les déclarations d''entrée papier.'
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "etat_des_lieux_entree_papier_sans_suppression" BEFORE DELETE ON "etat_des_lieux_entree_papier" FOR EACH ROW EXECUTE FUNCTION "public"."etat_des_lieux_entree_papier_interdire_suppression"();--> statement-breakpoint
CREATE TRIGGER "etat_des_lieux_entree_papier_sans_vidage" BEFORE TRUNCATE ON "etat_des_lieux_entree_papier" FOR EACH STATEMENT EXECUTE FUNCTION "public"."etat_des_lieux_entree_papier_interdire_suppression"();--> statement-breakpoint
-- Une correction écrit une nouvelle ligne : une ligne existante ne change
-- jamais, sauf pour être archivée une seule fois (archived_at et les
-- colonnes d'audit qui accompagnent toute écriture).
CREATE FUNCTION "public"."etat_des_lieux_entree_papier_immuable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL
    OR NEW.archived_at IS NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.etat_des_lieux_id IS DISTINCT FROM OLD.etat_des_lieux_id
    OR NEW.date_signature IS DISTINCT FROM OLD.date_signature
    OR NEW.lieu IS DISTINCT FROM OLD.lieu
    OR NEW.document_id IS DISTINCT FROM OLD.document_id
    OR NEW.signataires IS DISTINCT FROM OLD.signataires
    OR NEW.declaree_le IS DISTINCT FROM OLD.declaree_le
    OR NEW.declaree_par IS DISTINCT FROM OLD.declaree_par
  THEN
    RAISE EXCEPTION 'Modification interdite : une déclaration d''entrée papier ne peut qu''être archivée, une seule fois.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "etat_des_lieux_entree_papier_sans_modification" BEFORE UPDATE ON "etat_des_lieux_entree_papier" FOR EACH ROW EXECUTE FUNCTION "public"."etat_des_lieux_entree_papier_immuable"();--> statement-breakpoint
-- Exclusion mutuelle avec la signature numérique, filet de sécurité sous le
-- verrou FOR UPDATE de l'en-tête pris par les deux services : aucune
-- déclaration (ni correction) quand l'entrée est signée numériquement ou
-- la sortie signée.
CREATE FUNCTION "public"."etat_des_lieux_entree_papier_exclusive"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."etat_des_lieux_signature" s
    WHERE s.etat_des_lieux_id = NEW.etat_des_lieux_id AND s.archived_at IS NULL AND s.phase = 'entree'
  ) THEN
    RAISE EXCEPTION 'Entrée papier refusée : l''entrée de cet état des lieux est signée numériquement.'
      USING ERRCODE = 'exclusion_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "public"."etat_des_lieux_signature" s
    WHERE s.etat_des_lieux_id = NEW.etat_des_lieux_id AND s.archived_at IS NULL AND s.phase = 'sortie'
  ) THEN
    RAISE EXCEPTION 'Entrée papier refusée : la sortie de cet état des lieux est signée.'
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "etat_des_lieux_entree_papier_exclusive" BEFORE INSERT ON "etat_des_lieux_entree_papier" FOR EACH ROW EXECUTE FUNCTION "public"."etat_des_lieux_entree_papier_exclusive"();--> statement-breakpoint
CREATE FUNCTION "public"."etat_des_lieux_signature_entree_sans_papier"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phase = 'entree' AND EXISTS (
    SELECT 1 FROM "public"."etat_des_lieux_entree_papier" p
    WHERE p.etat_des_lieux_id = NEW.etat_des_lieux_id AND p.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Signature refusée : l''entrée de cet état des lieux a été établie sur papier.'
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "etat_des_lieux_signature_entree_sans_papier" BEFORE INSERT ON "etat_des_lieux_signature" FOR EACH ROW EXECUTE FUNCTION "public"."etat_des_lieux_signature_entree_sans_papier"();
