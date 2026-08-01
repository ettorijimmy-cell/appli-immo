CREATE TABLE "indices_irl" (
	"id" uuid PRIMARY KEY NOT NULL,
	"annee" integer NOT NULL,
	"trimestre" integer NOT NULL,
	"valeur" numeric(6, 2) NOT NULL,
	"date_recuperation" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "indices_irl_annee_trimestre_unique" ON "indices_irl" USING btree ("annee","trimestre");