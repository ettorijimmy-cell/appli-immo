CREATE TYPE "public"."appartement_type_energie" AS ENUM('electrique', 'gaz', 'les_deux');--> statement-breakpoint
CREATE TYPE "public"."etat_des_lieux_element_etat" AS ENUM('M', 'P', 'B', 'TB');--> statement-breakpoint
CREATE TYPE "public"."etat_des_lieux_inventaire_etat" AS ENUM('bon', 'dusage', 'mauvais');--> statement-breakpoint
CREATE TYPE "public"."etat_des_lieux_type_cle" AS ENUM('immeuble', 'porte_entree', 'boite_lettres', 'cave', 'badge_portail', 'parking', 'autre');--> statement-breakpoint
CREATE TYPE "public"."element_inventaire_meuble_categorie" AS ENUM('meuble', 'electromenager', 'vaisselle_linge');--> statement-breakpoint
CREATE TABLE "etats_des_lieux" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"bail_id" uuid NOT NULL,
	"date_entree" date,
	"date_sortie" date,
	"nouvelle_adresse_locataire" text,
	CONSTRAINT "etats_des_lieux_bail_id_unique" UNIQUE("bail_id")
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_compteurs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"electricite_numero_compteur_entree" text,
	"electricite_numero_compteur_sortie" text,
	"electricite_releve_hp_entree" numeric(10, 2),
	"electricite_releve_hp_sortie" numeric(10, 2),
	"electricite_releve_hc_entree" numeric(10, 2),
	"electricite_releve_hc_sortie" numeric(10, 2),
	"electricite_ancien_occupant_entree" numeric(10, 2),
	"electricite_ancien_occupant_sortie" numeric(10, 2),
	"gaz_numero_compteur_entree" text,
	"gaz_numero_compteur_sortie" text,
	"gaz_releve_entree" numeric(10, 2),
	"gaz_releve_sortie" numeric(10, 2),
	"eau_releve_froide_entree" numeric(10, 2),
	"eau_releve_froide_sortie" numeric(10, 2),
	"eau_releve_chaude_entree" numeric(10, 2),
	"eau_releve_chaude_sortie" numeric(10, 2),
	CONSTRAINT "etat_des_lieux_compteurs_etat_des_lieux_id_unique" UNIQUE("etat_des_lieux_id")
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_cles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"type_cle" "etat_des_lieux_type_cle" NOT NULL,
	"libelle_autre" text,
	"nombre_entree" integer,
	"nombre_sortie" integer,
	"commentaire" text
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_piece_cuisine" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"mur_description" text,
	"mur_etat_entree" "etat_des_lieux_element_etat",
	"mur_etat_sortie" "etat_des_lieux_element_etat",
	"sol_description" text,
	"sol_etat_entree" "etat_des_lieux_element_etat",
	"sol_etat_sortie" "etat_des_lieux_element_etat",
	"vitrage_volets_description" text,
	"vitrage_volets_etat_entree" "etat_des_lieux_element_etat",
	"vitrage_volets_etat_sortie" "etat_des_lieux_element_etat",
	"plafond_description" text,
	"plafond_etat_entree" "etat_des_lieux_element_etat",
	"plafond_etat_sortie" "etat_des_lieux_element_etat",
	"eclairage_description" text,
	"eclairage_etat_entree" "etat_des_lieux_element_etat",
	"eclairage_etat_sortie" "etat_des_lieux_element_etat",
	"prises_description" text,
	"prises_etat_entree" "etat_des_lieux_element_etat",
	"prises_etat_sortie" "etat_des_lieux_element_etat",
	"prises_nombre" integer,
	"placards_description" text,
	"placards_etat_entree" "etat_des_lieux_element_etat",
	"placards_etat_sortie" "etat_des_lieux_element_etat",
	"evier_description" text,
	"evier_etat_entree" "etat_des_lieux_element_etat",
	"evier_etat_sortie" "etat_des_lieux_element_etat",
	"plaques_cuisson_description" text,
	"plaques_cuisson_etat_entree" "etat_des_lieux_element_etat",
	"plaques_cuisson_etat_sortie" "etat_des_lieux_element_etat",
	"hotte_description" text,
	"hotte_etat_entree" "etat_des_lieux_element_etat",
	"hotte_etat_sortie" "etat_des_lieux_element_etat",
	"electromenager_description" text,
	CONSTRAINT "etat_des_lieux_piece_cuisine_etat_des_lieux_id_unique" UNIQUE("etat_des_lieux_id")
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_piece_entree" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"porte_description" text,
	"porte_etat_entree" "etat_des_lieux_element_etat",
	"porte_etat_sortie" "etat_des_lieux_element_etat",
	"sonnette_description" text,
	"sonnette_etat_entree" "etat_des_lieux_element_etat",
	"sonnette_etat_sortie" "etat_des_lieux_element_etat",
	"mur_description" text,
	"mur_etat_entree" "etat_des_lieux_element_etat",
	"mur_etat_sortie" "etat_des_lieux_element_etat",
	"sol_description" text,
	"sol_etat_entree" "etat_des_lieux_element_etat",
	"sol_etat_sortie" "etat_des_lieux_element_etat",
	"vitrage_volets_description" text,
	"vitrage_volets_etat_entree" "etat_des_lieux_element_etat",
	"vitrage_volets_etat_sortie" "etat_des_lieux_element_etat",
	"plafond_description" text,
	"plafond_etat_entree" "etat_des_lieux_element_etat",
	"plafond_etat_sortie" "etat_des_lieux_element_etat",
	"eclairage_description" text,
	"eclairage_etat_entree" "etat_des_lieux_element_etat",
	"eclairage_etat_sortie" "etat_des_lieux_element_etat",
	"prises_description" text,
	"prises_etat_entree" "etat_des_lieux_element_etat",
	"prises_etat_sortie" "etat_des_lieux_element_etat",
	"prises_nombre" integer,
	CONSTRAINT "etat_des_lieux_piece_entree_etat_des_lieux_id_unique" UNIQUE("etat_des_lieux_id")
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_piece_sejour" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"mur_description" text,
	"mur_etat_entree" "etat_des_lieux_element_etat",
	"mur_etat_sortie" "etat_des_lieux_element_etat",
	"sol_description" text,
	"sol_etat_entree" "etat_des_lieux_element_etat",
	"sol_etat_sortie" "etat_des_lieux_element_etat",
	"vitrage_volets_description" text,
	"vitrage_volets_etat_entree" "etat_des_lieux_element_etat",
	"vitrage_volets_etat_sortie" "etat_des_lieux_element_etat",
	"plafond_description" text,
	"plafond_etat_entree" "etat_des_lieux_element_etat",
	"plafond_etat_sortie" "etat_des_lieux_element_etat",
	"eclairage_description" text,
	"eclairage_etat_entree" "etat_des_lieux_element_etat",
	"eclairage_etat_sortie" "etat_des_lieux_element_etat",
	"prises_description" text,
	"prises_etat_entree" "etat_des_lieux_element_etat",
	"prises_etat_sortie" "etat_des_lieux_element_etat",
	"prises_nombre" integer,
	CONSTRAINT "etat_des_lieux_piece_sejour_etat_des_lieux_id_unique" UNIQUE("etat_des_lieux_id")
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_pieces_autre" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"libelle" text NOT NULL,
	"mur_description" text,
	"mur_etat_entree" "etat_des_lieux_element_etat",
	"mur_etat_sortie" "etat_des_lieux_element_etat",
	"sol_description" text,
	"sol_etat_entree" "etat_des_lieux_element_etat",
	"sol_etat_sortie" "etat_des_lieux_element_etat",
	"vitrage_volets_description" text,
	"vitrage_volets_etat_entree" "etat_des_lieux_element_etat",
	"vitrage_volets_etat_sortie" "etat_des_lieux_element_etat",
	"plafond_description" text,
	"plafond_etat_entree" "etat_des_lieux_element_etat",
	"plafond_etat_sortie" "etat_des_lieux_element_etat",
	"eclairage_description" text,
	"eclairage_etat_entree" "etat_des_lieux_element_etat",
	"eclairage_etat_sortie" "etat_des_lieux_element_etat",
	"prises_description" text,
	"prises_etat_entree" "etat_des_lieux_element_etat",
	"prises_etat_sortie" "etat_des_lieux_element_etat",
	"prises_nombre" integer
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_pieces_chambre" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"mur_description" text,
	"mur_etat_entree" "etat_des_lieux_element_etat",
	"mur_etat_sortie" "etat_des_lieux_element_etat",
	"sol_description" text,
	"sol_etat_entree" "etat_des_lieux_element_etat",
	"sol_etat_sortie" "etat_des_lieux_element_etat",
	"vitrage_volets_description" text,
	"vitrage_volets_etat_entree" "etat_des_lieux_element_etat",
	"vitrage_volets_etat_sortie" "etat_des_lieux_element_etat",
	"plafond_description" text,
	"plafond_etat_entree" "etat_des_lieux_element_etat",
	"plafond_etat_sortie" "etat_des_lieux_element_etat",
	"eclairage_description" text,
	"eclairage_etat_entree" "etat_des_lieux_element_etat",
	"eclairage_etat_sortie" "etat_des_lieux_element_etat",
	"prises_description" text,
	"prises_etat_entree" "etat_des_lieux_element_etat",
	"prises_etat_sortie" "etat_des_lieux_element_etat",
	"prises_nombre" integer
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_pieces_salle_de_bain" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"mur_description" text,
	"mur_etat_entree" "etat_des_lieux_element_etat",
	"mur_etat_sortie" "etat_des_lieux_element_etat",
	"sol_description" text,
	"sol_etat_entree" "etat_des_lieux_element_etat",
	"sol_etat_sortie" "etat_des_lieux_element_etat",
	"vitrage_volets_description" text,
	"vitrage_volets_etat_entree" "etat_des_lieux_element_etat",
	"vitrage_volets_etat_sortie" "etat_des_lieux_element_etat",
	"plafond_description" text,
	"plafond_etat_entree" "etat_des_lieux_element_etat",
	"plafond_etat_sortie" "etat_des_lieux_element_etat",
	"eclairage_description" text,
	"eclairage_etat_entree" "etat_des_lieux_element_etat",
	"eclairage_etat_sortie" "etat_des_lieux_element_etat",
	"prises_description" text,
	"prises_etat_entree" "etat_des_lieux_element_etat",
	"prises_etat_sortie" "etat_des_lieux_element_etat",
	"prises_nombre" integer,
	"lavabo_description" text,
	"lavabo_etat_entree" "etat_des_lieux_element_etat",
	"lavabo_etat_sortie" "etat_des_lieux_element_etat",
	"baignoire_description" text,
	"baignoire_etat_entree" "etat_des_lieux_element_etat",
	"baignoire_etat_sortie" "etat_des_lieux_element_etat"
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_pieces_wc" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"mur_description" text,
	"mur_etat_entree" "etat_des_lieux_element_etat",
	"mur_etat_sortie" "etat_des_lieux_element_etat",
	"sol_description" text,
	"sol_etat_entree" "etat_des_lieux_element_etat",
	"sol_etat_sortie" "etat_des_lieux_element_etat",
	"vitrage_volets_description" text,
	"vitrage_volets_etat_entree" "etat_des_lieux_element_etat",
	"vitrage_volets_etat_sortie" "etat_des_lieux_element_etat",
	"plafond_description" text,
	"plafond_etat_entree" "etat_des_lieux_element_etat",
	"plafond_etat_sortie" "etat_des_lieux_element_etat",
	"eclairage_description" text,
	"eclairage_etat_entree" "etat_des_lieux_element_etat",
	"eclairage_etat_sortie" "etat_des_lieux_element_etat",
	"prises_description" text,
	"prises_etat_entree" "etat_des_lieux_element_etat",
	"prises_etat_sortie" "etat_des_lieux_element_etat",
	"prises_nombre" integer,
	"lavabo_description" text,
	"lavabo_etat_entree" "etat_des_lieux_element_etat",
	"lavabo_etat_sortie" "etat_des_lieux_element_etat",
	"wc_description" text,
	"wc_etat_entree" "etat_des_lieux_element_etat",
	"wc_etat_sortie" "etat_des_lieux_element_etat"
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_equipements_divers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"libelle" text NOT NULL,
	"nombre_entree" integer,
	"etat_entree" "etat_des_lieux_inventaire_etat",
	"nombre_sortie" integer,
	"etat_sortie" "etat_des_lieux_inventaire_etat",
	"commentaire" text
);
--> statement-breakpoint
CREATE TABLE "elements_inventaire_meuble" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"code" text NOT NULL,
	"libelle" text NOT NULL,
	"categorie" "element_inventaire_meuble_categorie" NOT NULL,
	"ordre_affichage" integer NOT NULL,
	CONSTRAINT "elements_inventaire_meuble_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "etat_des_lieux_inventaire" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"etat_des_lieux_id" uuid NOT NULL,
	"element_id" uuid NOT NULL,
	"nombre_entree" integer,
	"etat_entree" "etat_des_lieux_inventaire_etat",
	"nombre_sortie" integer,
	"etat_sortie" "etat_des_lieux_inventaire_etat",
	"commentaire" text
);
--> statement-breakpoint
ALTER TABLE "appartements" ADD COLUMN "type_energie" "appartement_type_energie";--> statement-breakpoint
ALTER TABLE "etats_des_lieux" ADD CONSTRAINT "etats_des_lieux_bail_id_baux_id_fk" FOREIGN KEY ("bail_id") REFERENCES "public"."baux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_compteurs" ADD CONSTRAINT "etat_des_lieux_compteurs_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_cles" ADD CONSTRAINT "etat_des_lieux_cles_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_piece_cuisine" ADD CONSTRAINT "etat_des_lieux_piece_cuisine_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_piece_entree" ADD CONSTRAINT "etat_des_lieux_piece_entree_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_piece_sejour" ADD CONSTRAINT "etat_des_lieux_piece_sejour_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_pieces_autre" ADD CONSTRAINT "etat_des_lieux_pieces_autre_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_pieces_chambre" ADD CONSTRAINT "etat_des_lieux_pieces_chambre_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_pieces_salle_de_bain" ADD CONSTRAINT "etat_des_lieux_pieces_salle_de_bain_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_pieces_wc" ADD CONSTRAINT "etat_des_lieux_pieces_wc_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_equipements_divers" ADD CONSTRAINT "etat_des_lieux_equipements_divers_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_inventaire" ADD CONSTRAINT "etat_des_lieux_inventaire_etat_des_lieux_id_etats_des_lieux_id_fk" FOREIGN KEY ("etat_des_lieux_id") REFERENCES "public"."etats_des_lieux"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etat_des_lieux_inventaire" ADD CONSTRAINT "etat_des_lieux_inventaire_element_id_elements_inventaire_meuble_id_fk" FOREIGN KEY ("element_id") REFERENCES "public"."elements_inventaire_meuble"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_pieces_autre_numero_unique" ON "etat_des_lieux_pieces_autre" USING btree ("etat_des_lieux_id","numero");--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_pieces_chambre_numero_unique" ON "etat_des_lieux_pieces_chambre" USING btree ("etat_des_lieux_id","numero");--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_pieces_salle_de_bain_numero_unique" ON "etat_des_lieux_pieces_salle_de_bain" USING btree ("etat_des_lieux_id","numero");--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_pieces_wc_numero_unique" ON "etat_des_lieux_pieces_wc" USING btree ("etat_des_lieux_id","numero");--> statement-breakpoint
CREATE UNIQUE INDEX "etat_des_lieux_inventaire_element_unique" ON "etat_des_lieux_inventaire" USING btree ("etat_des_lieux_id","element_id");