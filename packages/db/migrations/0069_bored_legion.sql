ALTER TYPE "public"."document_categorie" ADD VALUE 'etat_des_lieux_docx';--> statement-breakpoint
ALTER TYPE "public"."document_categorie" ADD VALUE 'etat_des_lieux_pdf';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "est_etat_des_lieux_fige" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_etat_des_lieux_fige_unique" ON "documents" USING btree ("entite_id","categorie","etat_des_lieux_phase") WHERE "documents"."est_etat_des_lieux_fige";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_est_etat_des_lieux_fige_coherent" CHECK ("documents"."est_etat_des_lieux_fige" = ("documents"."categorie"::text IN ('etat_des_lieux_docx', 'etat_des_lieux_pdf')));