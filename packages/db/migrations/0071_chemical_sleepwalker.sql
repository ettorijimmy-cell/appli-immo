ALTER TABLE "etats_des_lieux" ADD COLUMN "observations_bailleur_entree" text;--> statement-breakpoint
ALTER TABLE "etats_des_lieux" ADD COLUMN "reserves_locataire_entree" text;--> statement-breakpoint
ALTER TABLE "etats_des_lieux" ADD COLUMN "observations_bailleur_sortie" text;--> statement-breakpoint
ALTER TABLE "etats_des_lieux" ADD COLUMN "reserves_locataire_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_cles" ADD COLUMN "commentaire_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_piece_cuisine" ADD COLUMN "observations_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_piece_entree" ADD COLUMN "observations_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_piece_sejour" ADD COLUMN "observations_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_pieces_autre" ADD COLUMN "observations_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_pieces_chambre" ADD COLUMN "observations_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_pieces_salle_de_bain" ADD COLUMN "observations_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_pieces_wc" ADD COLUMN "observations_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_equipements_divers" ADD COLUMN "commentaire_sortie" text;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_inventaire" ADD COLUMN "commentaire_sortie" text;