-- Correctif Scaleway (2026-09-14) : drizzle-kit migrate regroupe toutes
-- les migrations postérieures au dernier timestamp connu dans une seule
-- transaction. Sur un environnement où ni 0047 ni ce fichier n'ont encore
-- été appliqués (Scaleway), le SET NOT NULL ci-dessous échouait faute de
-- backfill préalable et annulait TOUTE la transaction, y compris les
-- ADD COLUMN de 0047 (colonnes disparues, pas seulement laissées à NULL).
-- Le backfill doit donc vivre ICI, dans la même migration, pour que le
-- SET NOT NULL voie des valeurs déjà renseignées dans la même transaction
-- — même mécanisme et même correctif que l'incident bien.nomProprietaire.
--
-- Logique identique à apps/backend/scripts/backfill-organisation-
-- locataires-garants.ts, traduite en SQL brut (ce script reste utile en
-- local pour un backfill ponctuel hors migration, mais ne peut pas à lui
-- seul résoudre ce cas : il tourne dans une transaction séparée, après
-- que celle de la migration a déjà échoué et tout annulé).
--
-- Un locataire dont les baux (via bail_locataires) pointent vers des
-- organisations DIFFÉRENTES reste volontairement à NULL (HAVING COUNT
-- (DISTINCT organisation_id) = 1) — jamais de choix arbitraire entre
-- plusieurs organisations candidates. Si un tel cas existe réellement,
-- le SET NOT NULL qui suit échouera pour cette ligne précise : à remonter
-- pour arbitrage, jamais à deviner ni à contourner en assouplissant cette
-- clause.
WITH orga_locataire AS (
	SELECT bl.locataire_id, (array_agg(b.organisation_id))[1] AS organisation_id
	FROM bail_locataires bl
	JOIN baux ba ON ba.id = bl.bail_id
	JOIN appartements a ON a.id = ba.appartement_id
	JOIN bien b ON b.id = a.bien_id
	GROUP BY bl.locataire_id
	HAVING COUNT(DISTINCT b.organisation_id) = 1
)
UPDATE locataires l
SET organisation_id = ol.organisation_id
FROM orga_locataire ol
WHERE ol.locataire_id = l.id
	AND l.organisation_id IS NULL;
--> statement-breakpoint
-- Un garant n'a qu'un seul bail (bail_id NOT NULL) : aucune ambiguïté
-- multi-organisation possible, contrairement à locataires ci-dessus.
UPDATE garants g
SET organisation_id = b.organisation_id
FROM baux ba
JOIN appartements a ON a.id = ba.appartement_id
JOIN bien b ON b.id = a.bien_id
WHERE ba.id = g.bail_id
	AND g.organisation_id IS NULL;
--> statement-breakpoint
ALTER TABLE "locataires" ALTER COLUMN "organisation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "garants" ALTER COLUMN "organisation_id" SET NOT NULL;
