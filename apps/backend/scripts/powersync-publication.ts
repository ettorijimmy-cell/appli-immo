import { createDbClient } from "db";
import { sql } from "drizzle-orm";

// Gère la publication Postgres "powersync" (CREATE PUBLICATION powersync
// FOR TABLE ..., voir docs/backlog.md et docs/data-dictionary.md) — la
// source de la réplication logique PowerSync. Lecture seule par défaut :
// affiche la publication actuelle et le différentiel avec la liste
// attendue. N'applique l'ALTER PUBLICATION qu'avec --apply, dans une
// transaction, puis réaffiche la liste finale.
//
// Cible : seul 212.47.241.9:17700/rdb (production) est autorisé par
// défaut, puisque seul le propriétaire des tables (appli_immo_app) peut
// altérer la publication, et que c'est la seule publication réelle
// aujourd'hui — dev et base jetable n'en ont pas, elles ne se connectent
// jamais à PowerSync. --allow-non-prod lève ce garde-fou, réservé aux
// essais (jamais par défaut).
//
// Lancé par Jimmy lui-même contre la production, jamais par Claude.

const HOTE_PROD = "212.47.241.9";
const PORT_PROD = "17700";
const BASE_PROD = "rdb";
const NOM_PUBLICATION = "powersync";

// Liste attendue, ÉCRITE EN DUR (pas calculée à partir d'une lecture) :
// la publication actuelle en production (33 tables, lue le 2026-10-18)
// + bien, bien_immeuble_detail, tache, depense, sinistre (streams/
// branches décidés le 2026-10-18 — voir docs/powersync-sync-streams.yaml)
// − comptes_bancaires_sci (aucun stream ne l'utilise, décision 2026-10-18).
// Toute évolution future de cette liste doit être éditée ici à la main,
// jamais dérivée automatiquement d'une lecture de pg_publication_tables.
const PUBLICATION_ATTENDUE: readonly string[] = [
  "alertes",
  "appartements",
  "bail_locataires",
  "baux",
  "bien",
  "bien_immeuble_detail",
  "depense",
  "diagnostics",
  "documents",
  "elements_inventaire_meuble",
  "equipements",
  "etat_des_lieux_cles",
  "etat_des_lieux_compteurs",
  "etat_des_lieux_equipements_divers",
  "etat_des_lieux_inventaire",
  "etat_des_lieux_piece_cuisine",
  "etat_des_lieux_piece_entree",
  "etat_des_lieux_piece_sejour",
  "etat_des_lieux_pieces_autre",
  "etat_des_lieux_pieces_chambre",
  "etat_des_lieux_pieces_salle_de_bain",
  "etat_des_lieux_pieces_wc",
  "etats_des_lieux",
  "garants",
  "immeubles_legacy",
  "indices_irl",
  "locataires",
  "organisation_sci",
  "organisations",
  "paiements",
  "parametres_alertes",
  "remboursements",
  "scis",
  "sinistre",
  "tache",
  "utilisateurs",
  "versements"
];

type DbClient = ReturnType<typeof createDbClient>;

function cibleAffichable(url: URL): string {
  // Jamais le mot de passe ni l'URL complète — seulement hôte:port/base.
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

function verifierCible(url: URL, autoriserNonProd: boolean): void {
  const base = url.pathname.replace(/^\//, "");
  const cibleOk = url.hostname === HOTE_PROD && (url.port || "5432") === PORT_PROD && base === BASE_PROD;
  if (cibleOk) return;

  if (autoriserNonProd) {
    console.warn(
      `ATTENTION : cible non-production acceptée via --allow-non-prod (${cibleAffichable(url)}). ` +
        `Réservé aux essais — jamais contre une base réelle autre que ${HOTE_PROD}:${PORT_PROD}/${BASE_PROD}.`
    );
    return;
  }

  console.error(
    `Cible refusée : ce script ne doit s'exécuter que contre ${HOTE_PROD}:${PORT_PROD}/${BASE_PROD}. ` +
      `Cible fournie : ${cibleAffichable(url)}. ` +
      `Pour un essai contre une base non-production, relancer avec --allow-non-prod.`
  );
  process.exit(1);
}

async function lirePublication(db: DbClient): Promise<string[]> {
  const lignes = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_publication_tables WHERE pubname = ${NOM_PUBLICATION} ORDER BY tablename`
  );
  return lignes.map((ligne) => ligne.tablename);
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("DATABASE_URL doit être défini explicitement — aucun repli implicite pour ce script.");
    process.exit(1);
    return;
  }

  const appliquer = process.argv.includes("--apply");
  const autoriserNonProd = process.argv.includes("--allow-non-prod");

  const url = new URL(databaseUrl);
  verifierCible(url, autoriserNonProd);
  const cible = cibleAffichable(url);

  const db = createDbClient(databaseUrl);
  try {
    const actuelle = await lirePublication(db);
    console.log(`Publication "${NOM_PUBLICATION}" sur ${cible} — ${actuelle.length} table(s) :`);
    console.log(actuelle.join(", ") || "(vide)");

    const aAjouter = PUBLICATION_ATTENDUE.filter((table) => !actuelle.includes(table));
    const aRetirer = actuelle.filter((table) => !PUBLICATION_ATTENDUE.includes(table));

    console.log(`\nÀ ajouter (${aAjouter.length}) : ${aAjouter.join(", ") || "(aucune)"}`);
    console.log(`À retirer (${aRetirer.length}) : ${aRetirer.join(", ") || "(aucune)"}`);

    if (!appliquer) {
      console.log('\nLecture seule (par défaut) — relancer avec --apply pour appliquer ce différentiel.');
      return;
    }

    if (aAjouter.length === 0 && aRetirer.length === 0) {
      console.log("\nRien à appliquer.");
      return;
    }

    console.log("\nApplication du différentiel dans une transaction...");
    await db.transaction(async (tx) => {
      for (const table of aAjouter) {
        await tx.execute(sql`ALTER PUBLICATION ${sql.identifier(NOM_PUBLICATION)} ADD TABLE ${sql.identifier(table)}`);
      }
      for (const table of aRetirer) {
        await tx.execute(sql`ALTER PUBLICATION ${sql.identifier(NOM_PUBLICATION)} DROP TABLE ${sql.identifier(table)}`);
      }
    });

    const finale = await lirePublication(db);
    console.log(`\nPublication "${NOM_PUBLICATION}" après application, sur ${cible} — ${finale.length} table(s) :`);
    console.log(finale.join(", ") || "(vide)");
  } finally {
    await db.$client.end();
  }
}

void main();
