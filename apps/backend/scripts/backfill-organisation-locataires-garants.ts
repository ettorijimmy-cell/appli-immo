import { createDbClient, DEFAULT_DEV_DATABASE_URL, garants, locataires } from "db";
import { isNull, sql } from "drizzle-orm";

// Module Carnet de contacts (2026-09-13) — Phase B : backfill de
// locataires.organisation_id / garants.organisation_id, ajoutés nullable
// en Phase A. Résolution via la jointure existante (locataire ->
// bail_locataires -> baux -> appartements -> bien -> organisation_id ;
// garant -> bail -> appartement -> bien -> organisation_id), une seule
// fois, avant le passage en NOT NULL de Phase C.
//
// Un locataire lié (via bail_locataires) à des baux d'appartements
// appartenant à des organisations DIFFÉRENTES n'a normalement aucune
// raison d'exister dans ce projet mono-organisation — la clause HAVING
// COUNT(DISTINCT organisation_id) = 1 exclut volontairement ce cas plutôt
// que de choisir arbitrairement laquelle des organisations retenir ; la
// ligne reste à NULL et est signalée en sortie pour résolution manuelle.
// Un garant n'a lui qu'un seul bail (bail_id NOT NULL, pas de fan-out
// possible), aucune ambiguïté équivalente à gérer côté garants.
async function main(): Promise<void> {
  const db = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);

  const [{ count: locatairesSansOrgaAvant }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(locataires)
    .where(isNull(locataires.organisationId));
  const [{ count: garantsSansOrgaAvant }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(garants)
    .where(isNull(garants.organisationId));
  console.log(`Avant backfill — locataires sans organisation_id : ${locatairesSansOrgaAvant}`);
  console.log(`Avant backfill — garants sans organisation_id : ${garantsSansOrgaAvant}`);

  await db.execute(sql`
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
      AND l.organisation_id IS NULL
  `);

  await db.execute(sql`
    UPDATE garants g
    SET organisation_id = b.organisation_id
    FROM baux ba
    JOIN appartements a ON a.id = ba.appartement_id
    JOIN bien b ON b.id = a.bien_id
    WHERE ba.id = g.bail_id
      AND g.organisation_id IS NULL
  `);

  const locatairesSansOrgaApres = await db
    .select({ id: locataires.id })
    .from(locataires)
    .where(isNull(locataires.organisationId));
  const garantsSansOrgaApres = await db.select({ id: garants.id }).from(garants).where(isNull(garants.organisationId));

  console.log(`Après backfill — locataires encore sans organisation_id : ${locatairesSansOrgaApres.length}`);
  if (locatairesSansOrgaApres.length > 0) {
    console.log(locatairesSansOrgaApres.map((l) => l.id));
  }
  console.log(`Après backfill — garants encore sans organisation_id : ${garantsSansOrgaApres.length}`);
  if (garantsSansOrgaApres.length > 0) {
    console.log(garantsSansOrgaApres.map((g) => g.id));
  }

  await db.$client.end();
}

void main();
