ALTER TABLE "bien" ADD COLUMN "type_habitat" "immeuble_type_habitat";--> statement-breakpoint
ALTER TABLE "bien" ADD COLUMN "regime_juridique" "immeuble_regime_juridique";--> statement-breakpoint
-- Ajout manuel (données SQL générées par drizzle-kit ci-dessus/ci-dessous,
-- inchangées) : préserve les valeurs existantes de bien_immeuble_detail
-- avant leur suppression par les DROP COLUMN suivants, plutôt que de les
-- perdre silencieusement.
UPDATE "bien" SET
  "type_habitat" = "bien_immeuble_detail"."type_habitat",
  "regime_juridique" = "bien_immeuble_detail"."regime_juridique"
FROM "bien_immeuble_detail"
WHERE "bien_immeuble_detail"."bien_id" = "bien"."id";--> statement-breakpoint
ALTER TABLE "bien_immeuble_detail" DROP COLUMN "type_habitat";--> statement-breakpoint
ALTER TABLE "bien_immeuble_detail" DROP COLUMN "regime_juridique";