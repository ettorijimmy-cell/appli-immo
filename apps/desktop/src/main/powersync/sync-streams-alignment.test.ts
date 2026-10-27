import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppSchema } from "./schema";

// Garde-fou PowerSync : compare TROIS sources indépendantes pour chaque table
// présente dans schema.ts (le schéma client réellement déclaré) —
// 1. packages/db/src/schema/*.ts (Drizzle, source de vérité du schéma Postgres)
// 2. docs/powersync-sync-streams.yaml (liste de colonnes du Sync Stream)
// 3. schema.ts lui-même (ce fichier, déjà chargé via l'import ci-dessus)
//
// Objectif : qu'une colonne Drizzle ajoutée après-coup ne puisse plus rester
// absente du yaml/schema.ts sans que ce test échoue, et qu'aucune colonne
// yaml/schema.ts ne devienne silencieusement obsolète (colonne renommée/
// supprimée côté Drizzle). Toute colonne Drizzle non exposée doit figurer
// dans EXCLUSIONS ci-dessous avec une justification — sinon le test échoue.
//
// Lecture en texte brut (regex), jamais par import, pour packages/db et le
// yaml : apps/desktop n'a et ne doit jamais avoir de dépendance d'exécution
// vers Drizzle (CLAUDE.md, "ORM : Drizzle ... jamais côté SQLite local").
// schema.ts est en revanche importé réellement (fichier frère, même
// package) : on introspecte l'objet Schema/Table du SDK @powersync/node
// lui-même plutôt que de reparser ce qu'on vient d'écrire.

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const DRIZZLE_SCHEMA_DIR = join(REPO_ROOT, "packages", "db", "src", "schema");
const COLUMNS_HELPERS_PATH = join(DRIZZLE_SCHEMA_DIR, "columns.helpers.ts");
const YAML_PATH = join(REPO_ROOT, "docs", "powersync-sync-streams.yaml");

// Colonnes d'audit (packages/db/src/schema/columns.helpers.ts, `auditColumns`)
// réellement blanches pour TOUTES les tables :
// - id : colonne implicite de PowerSync, déclarée automatiquement dans
//   schema.ts et sélectionnée par chaque stream — ce n'est pas une
//   exclusion métier, c'est un mécanisme du SDK (voir en-tête schema.ts).
// - created_at / updated_by : bookkeeping interne, jamais affiché ni
//   édité côté desktop, flux PowerSync en lecture seule (AppConnector.
//   uploadData lève systématiquement) — aucune réconciliation d'auteur/
//   date de création n'a de sens côté client aujourd'hui.
// archived_at et version NE SONT PAS dans cette liste : ils doivent être
// EXPOSÉS (yaml + schema.ts) sur toute table qui les porte côté Drizzle,
// pas exclus — préparation de l'étape (a) (lignes archivées indiscernables
// côté client sinon) et de l'étape (b) (contrôle de concurrence optimiste).
const AUDIT_COLUMNS_EXCLUSION = {
  id: "colonne implicite de PowerSync, déclarée automatiquement dans schema.ts et sélectionnée par chaque stream (voir en-tête schema.ts)",
  created_at: "bookkeeping interne, jamais affiché côté desktop, flux PowerSync en lecture seule",
  updated_by: "bookkeeping interne, flux PowerSync en lecture seule — aucune réconciliation d'auteur côté client"
} as const;

// Exclusions spécifiques déjà actées et documentées — une ligne de
// justification par colonne.
const EXCLUSIONS: Record<string, Record<string, string>> = {
  garants: {
    profession: "donnée personnelle du garant, pas de besoin de consultation hors ligne (schema.ts)",
    revenus: "donnée financière du garant, pas de besoin de consultation hors ligne (schema.ts)",
    organisation_id: "non nécessaire au filtrage : la chaîne de jointures existante (bail -> appartement -> bien -> organisation) suffit déjà (décision 2026-10-18)"
  },
  appartements: {
    identifiant_fiscal: "donnée fiscale nominative du lot, exclue du Sync Stream (schema.ts)"
  },
  versements: {
    reference_rapprochement: "libellé brut de ligne de relevé bancaire importé, hors de notre contrôle (schema.ts)"
  },
  remboursements: {
    commentaire: "texte libre non contraint, saisi manuellement (schema.ts)",
    piece_justificative_chemin: "même motif que documents.chemin_stockage — chemin du blob chiffré sur disque, jamais exposable (déjà documenté dans le yaml)"
  },
  documents: {
    chemin_stockage: "chemin/clé du blob chiffré sur disque — ne doit jamais apparaître en clair dans la base SQLite locale (schema.ts)",
    est_etat_des_lieux_fige: "bookkeeping interne purement serveur (chantier PDF étape 4, 2026-10-27) — pilote uniquement l'index unique partiel Postgres (documents_etat_des_lieux_fige_unique), aucune lecture ni décision d'UI côté desktop ne s'appuie sur ce booléen, contrairement à ajoutee_apres_signature_entree (celle-ci pilote un bouton réel)"
  },
  alertes: {
    derniere_condition_vraie: "champ interne, jamais exposé à l'utilisateur (schema.ts, packages/db/src/schema/alertes.ts)"
  },
  etat_des_lieux_cles: {
    commentaire: "texte libre annexe, même motif que remboursements.commentaire (schema.ts)"
  },
  etat_des_lieux_equipements_divers: {
    commentaire: "texte libre annexe, même motif (schema.ts)"
  },
  etat_des_lieux_inventaire: {
    commentaire: "texte libre annexe, même motif (schema.ts)"
  },
  locataires: {
    organisation_id: "non nécessaire au filtrage : la chaîne de jointures existante suffit déjà (décision 2026-10-18)"
  }
};

// Alias EXPLICITE schema.ts -> nom de table Postgres, uniquement quand ils
// diffèrent. Un seul cas aujourd'hui : la clé "immeubles" a été conservée
// telle quelle côté client lors de la migration bien (2026-08-26) alors que
// la table Postgres a été renommée en immeubles_legacy (voir le commentaire
// du stream "immeubles" dans le yaml). Jamais déduit implicitement du FROM
// du yaml : fixé ici, et vérifié explicitement contre le FROM du yaml par
// le test ci-dessous.
const ALIAS_SCHEMA_TS_VERS_DRIZZLE: Record<string, string> = {
  immeubles: "immeubles_legacy"
};

function justificationPour(table: string, colonne: string): string | undefined {
  if (colonne in AUDIT_COLUMNS_EXCLUSION) {
    return AUDIT_COLUMNS_EXCLUSION[colonne as keyof typeof AUDIT_COLUMNS_EXCLUSION];
  }
  return EXCLUSIONS[table]?.[colonne];
}

interface ColonneSansNom {
  contexte: string;
  entree: string;
}

interface ResultatEntrees {
  colonnes: Set<string>;
  sansNom: ColonneSansNom[];
}

// Isole, à partir d'une position de départ, le contenu d'une paire
// d'accolades équilibrée (profondeur), et renvoie le texte entre les deux
// accolades (sans elles) ainsi que l'index juste après l'accolade fermante.
function extraireCorpsAccolades(texte: string, indexOuverture: number): { corps: string; indexApresFermeture: number } | null {
  let profondeur = 0;
  for (let i = indexOuverture; i < texte.length; i++) {
    if (texte[i] === "{") profondeur++;
    else if (texte[i] === "}") {
      profondeur--;
      if (profondeur === 0) {
        return { corps: texte.slice(indexOuverture + 1, i), indexApresFermeture: i + 1 };
      }
    }
  }
  return null;
}

// Découpe un corps d'objet JS en entrées de premier niveau (séparées par une
// virgule à profondeur 0), en respectant les parenthèses/accolades/crochets
// imbriqués (ex. decimal("montant", { precision: 10, scale: 2 }) sur
// plusieurs lignes — un split naïf sur "," casserait cette valeur en deux).
// Les commentaires `//` sont retirés avant découpage (une parenthèse ou une
// virgule dans un commentaire en prose ne doit jamais fausser la profondeur).
function diviserEntreesSommet(corps: string): string[] {
  // \r retiré avant tout : fichiers source en CRLF — sans ce retrait, le "$"
  // de la regex de commentaire ne correspond plus juste avant le \r restant
  // en fin de ligne, et le commentaire n'est alors jamais retiré.
  const sansCommentaires = corps
    .replace(/\r/g, "")
    .split("\n")
    .map((ligne) => ligne.replace(/\/\/.*$/, ""))
    .join("\n");

  const entrees: string[] = [];
  let profondeur = 0;
  let dansChaine = false;
  let debut = 0;
  for (let i = 0; i < sansCommentaires.length; i++) {
    const c = sansCommentaires[i];
    if (dansChaine) {
      if (c === '"' && sansCommentaires[i - 1] !== "\\") dansChaine = false;
      continue;
    }
    if (c === '"') {
      dansChaine = true;
    } else if (c === "(" || c === "{" || c === "[") {
      profondeur++;
    } else if (c === ")" || c === "}" || c === "]") {
      profondeur--;
    } else if (c === "," && profondeur === 0) {
      entrees.push(sansCommentaires.slice(debut, i));
      debut = i + 1;
    }
  }
  entrees.push(sansCommentaires.slice(debut));
  return entrees.map((e) => e.trim()).filter((e) => e.length > 0);
}

// Résout chaque entrée de premier niveau en nom de colonne SQL (le premier
// argument littéral entre guillemets du constructeur de colonne). Toute
// entrée qui ne correspond pas à ce format (ex. un helper partagé appelé
// sans nom de colonne entre guillemets, ou un spread autre que
// `...auditColumns`) est renvoyée dans `sansNom` plutôt que silencieusement
// ignorée — c'est ce que la colonne resterait sinon : absente de toute
// liste, sans qu'aucun test ne le signale.
function resoudreColonnesDepuisEntrees(entrees: string[], auditColumnsNoms: Set<string> | null, contexte: string): ResultatEntrees {
  const colonnes = new Set<string>();
  const sansNom: ColonneSansNom[] = [];

  for (const entree of entrees) {
    if (entree.startsWith("...")) {
      if (auditColumnsNoms && entree.replace(/\s+/g, "") === "...auditColumns") {
        for (const nom of auditColumnsNoms) colonnes.add(nom);
      } else {
        sansNom.push({ contexte, entree });
      }
      continue;
    }
    const matchPropriete = /^([a-zA-Z_$][\w$]*)\s*:\s*([\s\S]*)$/.exec(entree);
    if (!matchPropriete) {
      sansNom.push({ contexte, entree });
      continue;
    }
    const valeur = matchPropriete[2]!.trim();
    const matchNomColonne = /^[\w.]+\(\s*"([a-z0-9_]+)"/.exec(valeur);
    if (!matchNomColonne) {
      sansNom.push({ contexte, entree });
      continue;
    }
    colonnes.add(matchNomColonne[1]!);
  }

  return { colonnes, sansNom };
}

// Lit packages/db/src/schema/columns.helpers.ts plutôt que de recopier la
// liste de auditColumns en dur ici : un changement de cette liste (colonne
// ajoutée/retirée) doit se répercuter automatiquement, sans édition
// manuelle de ce fichier de test.
function lireAuditColumns(): ResultatEntrees {
  const texte = readFileSync(COLUMNS_HELPERS_PATH, "utf-8");
  const indexDeclaration = texte.indexOf("auditColumns = {");
  if (indexDeclaration === -1) {
    return { colonnes: new Set(), sansNom: [{ contexte: "columns.helpers.ts", entree: "déclaration auditColumns introuvable" }] };
  }
  const indexOuverture = texte.indexOf("{", indexDeclaration);
  const extrait = extraireCorpsAccolades(texte, indexOuverture);
  if (!extrait) {
    return { colonnes: new Set(), sansNom: [{ contexte: "columns.helpers.ts", entree: "accolade fermante introuvable" }] };
  }
  const entrees = diviserEntreesSommet(extrait.corps);
  return resoudreColonnesDepuisEntrees(entrees, null, "columns.helpers.ts:auditColumns");
}

interface TableDrizzle {
  nomTable: string;
  colonnes: Set<string>;
}

// Extrait, pour chaque fichier packages/db/src/schema/*.ts, chaque appel
// pgTable("nom_table", { ...colonnes... }).
function parserSchemaDrizzle(auditColumnsNoms: Set<string>): { tables: Map<string, TableDrizzle>; sansNom: ColonneSansNom[] } {
  const resultat = new Map<string, TableDrizzle>();
  const sansNom: ColonneSansNom[] = [];
  const fichiers = readdirSync(DRIZZLE_SCHEMA_DIR).filter(
    (f) => f.endsWith(".ts") && f !== "index.ts" && f !== "columns.helpers.ts"
  );

  for (const fichier of fichiers) {
    const texte = readFileSync(join(DRIZZLE_SCHEMA_DIR, fichier), "utf-8");
    const regexAppel = /pgTable\(\s*"([a-z0-9_]+)"\s*,/g;
    let matchAppel: RegExpExecArray | null;
    while ((matchAppel = regexAppel.exec(texte)) !== null) {
      const nomTable = matchAppel[1];
      if (!nomTable) continue;
      const indexOuverture = texte.indexOf("{", matchAppel.index + matchAppel[0].length);
      if (indexOuverture === -1) continue;
      const extrait = extraireCorpsAccolades(texte, indexOuverture);
      if (!extrait) continue;

      const entrees = diviserEntreesSommet(extrait.corps);
      const { colonnes, sansNom: sansNomTable } = resoudreColonnesDepuisEntrees(entrees, auditColumnsNoms, `${fichier}:${nomTable}`);
      sansNom.push(...sansNomTable);
      resultat.set(nomTable, { nomTable, colonnes });
    }
  }
  return { tables: resultat, sansNom };
}

interface StreamYaml {
  cleStream: string;
  tableFrom: string;
  colonnes: Set<string>;
}

// Extrait chaque bloc "  <clé>:\n    query: >\n<corps>\n    auto_subscribe:
// true" du yaml, puis isole "SELECT <colonnes> FROM <table>" dans le corps
// (non-greedy jusqu'au premier FROM : suffisant, le FROM de la requête
// principale est toujours le premier token FROM rencontré). `\r?` devant
// chaque `\n` : tolère un fichier en CRLF, pas seulement en LF — incident
// du 2026-10-24 où un `git checkout` (core.autocrlf=true sur une machine
// Windows) a réécrit le yaml en CRLF et fait tomber ce parseur à zéro bloc
// trouvé, silencieusement (voir le test dédié "tolère un contenu en CRLF"
// plus bas). `texte` paramétrable (au lieu d'une lecture disque fixe) pour
// permettre ce test sans passer par un fichier temporaire sur disque.
function parserStreamsYaml(texte: string = readFileSync(YAML_PATH, "utf-8")): Map<string, StreamYaml> {
  const resultat = new Map<string, StreamYaml>();
  const regexBloc = /^ {2}([a-z][a-z0-9_]*):\r?\n {4}query: >\r?\n([\s\S]*?)\r?\n {4}auto_subscribe: true/gm;
  let matchBloc: RegExpExecArray | null;
  while ((matchBloc = regexBloc.exec(texte)) !== null) {
    const cleStream = matchBloc[1];
    const corps = matchBloc[2];
    if (!cleStream || !corps) continue;
    const matchSelect = /SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)/.exec(corps);
    if (!matchSelect) continue;
    const colonnesTexte = matchSelect[1];
    const tableFrom = matchSelect[2];
    if (!colonnesTexte || !tableFrom) continue;
    const colonnes = new Set(
      colonnesTexte
        .split(",")
        .map((c) => c.replace(/\s+/g, " ").trim())
        .filter((c) => c.length > 0)
    );
    resultat.set(cleStream, { cleStream, tableFrom, colonnes });
  }
  return resultat;
}

describe("PowerSync — alignement Drizzle / yaml / schema.ts (3 sources)", () => {
  const auditColumnsResultat = lireAuditColumns();

  it("auditColumns (columns.helpers.ts) compte exactement 6 colonnes", () => {
    expect(
      auditColumnsResultat.sansNom,
      "Entrée(s) de auditColumns dont le nom de colonne n'a pas pu être extrait"
    ).toEqual([]);
    expect(
      [...auditColumnsResultat.colonnes].sort(),
      "auditColumns ne compte plus 6 colonnes — un changement ici doit être répercuté " +
        "explicitement dans ce test (AUDIT_COLUMNS_EXCLUSION et/ou EXCLUSIONS), pas ignoré."
    ).toEqual(["archived_at", "created_at", "id", "updated_at", "updated_by", "version"]);
  });

  const { tables: drizzle, sansNom: colonnesSansNom } = parserSchemaDrizzle(auditColumnsResultat.colonnes);
  const streams = parserStreamsYaml();

  it("aucune colonne Drizzle n'a de nom de colonne non résolu", () => {
    expect(
      colonnesSansNom,
      "Entrée(s) de table Drizzle dont le nom de colonne SQL n'a pas pu être extrait " +
        "(ex. colonne définie via un helper partagé sans nom entre guillemets, ou spread " +
        "inconnu) — une telle colonne échapperait silencieusement à toute vérification."
    ).toEqual([]);
  });

  it("a bien trouvé des tables Drizzle (sanity check du parsing)", () => {
    expect(drizzle.size).toBeGreaterThan(30);
  });

  it("le nombre de streams parsés correspond au nombre de blocs \"query: >\" du yaml", () => {
    const texteYaml = readFileSync(YAML_PATH, "utf-8");
    const nombreBlocsQuery = (texteYaml.match(/query: >/g) ?? []).length;
    expect(
      streams.size,
      "Un bloc \"query: >\" n'a pas produit d'entrée — vérifier qu'il a bien un " +
        "\"auto_subscribe: true\" dans le format attendu (le parseur l'exige pour délimiter " +
        "le corps de la requête), sinon il est ignoré sans erreur."
    ).toBe(nombreBlocsQuery);
  });

  it("parserStreamsYaml tolère un yaml en CRLF à l'identique d'un yaml en LF — reproduit l'incident du 2026-10-24", () => {
    const contenuLf =
      "streams:\n" +
      "  exemple_stream:\n" +
      "    query: >\n" +
      "      SELECT id, colonne_a, colonne_b FROM exemple_table\n" +
      "    auto_subscribe: true\n";
    const contenuCrlf = contenuLf.replace(/\n/g, "\r\n");

    const streamsLf = parserStreamsYaml(contenuLf);
    const streamsCrlf = parserStreamsYaml(contenuCrlf);

    expect(streamsLf.size, "le contenu de référence (LF) doit produire exactement 1 stream").toBe(1);
    expect(
      streamsCrlf.size,
      "le même contenu en CRLF doit produire exactement le même nombre de streams — sans le " +
        "\\r? ajouté à regexBloc, ce test échouait avec 0 stream trouvé, silencieusement."
    ).toBe(1);
    expect(streamsCrlf.get("exemple_stream")).toEqual(streamsLf.get("exemple_stream"));
  });

  it("diviserEntreesSommet (parsing des fichiers packages/db/src/schema/*.ts) tolère un corps en CRLF à l'identique d'un corps en LF", () => {
    const corpsLf = 'nom: text("nom").notNull(),\n' + "// commentaire à ignorer, y compris sa virgule finale,\n" + 'age: integer("age")';
    const corpsCrlf = corpsLf.replace(/\n/g, "\r\n");

    expect(
      diviserEntreesSommet(corpsCrlf),
      "déjà protégé par le retrait explicite de \\r en tête de diviserEntreesSommet " +
        "(voir son commentaire) — ce test en fait une garantie vérifiée, pas seulement documentée."
    ).toEqual(diviserEntreesSommet(corpsLf));
  });

  const clesSchemaTs = new Set(AppSchema.tables.map((t) => t.name));

  // Sens inverse : un stream yaml sans table schema.ts correspondante doit
  // aussi faire échouer le test — pas seulement "table schema.ts sans
  // stream" (déjà couvert dans la boucle ci-dessous).
  for (const cleYaml of streams.keys()) {
    it(`le stream yaml "${cleYaml}" a une table schema.ts correspondante`, () => {
      expect(
        clesSchemaTs.has(cleYaml),
        `Le yaml décrit un stream "${cleYaml}" mais aucune table de ce nom n'existe dans schema.ts — ` +
          `stream documenté mais jamais déclaré côté client, ou table renommée d'un seul côté.`
      ).toBe(true);
    });
  }

  for (const tableResolue of AppSchema.tables) {
    const cleSchemaTs = tableResolue.name;
    const colonnesSchemaTs = new Set(tableResolue.columns.map((c) => c.name));

    describe(`table "${cleSchemaTs}" (présente dans schema.ts)`, () => {
      it("a un stream décrit dans docs/powersync-sync-streams.yaml", () => {
        expect(
          streams.has(cleSchemaTs),
          `Aucun bloc "query:" trouvé pour "${cleSchemaTs}" dans le yaml — table présente côté ` +
            `client sans flux déclaré.`
        ).toBe(true);
      });

      const streamCorrespondant = streams.get(cleSchemaTs);
      // Nom de table Drizzle attendu : l'alias explicite s'il existe,
      // sinon la clé schema.ts elle-même — jamais déduit du FROM du yaml
      // (voir ALIAS_SCHEMA_TS_VERS_DRIZZLE ci-dessus).
      const nomTableDrizzle = ALIAS_SCHEMA_TS_VERS_DRIZZLE[cleSchemaTs] ?? cleSchemaTs;
      const tableDrizzle = drizzle.get(nomTableDrizzle);

      if (streamCorrespondant) {
        it(`le FROM du yaml correspond au nom de table Drizzle attendu ("${nomTableDrizzle}")`, () => {
          expect(
            streamCorrespondant.tableFrom,
            `Le stream "${cleSchemaTs}" fait un FROM ${streamCorrespondant.tableFrom} mais la table Drizzle ` +
              `attendue (via ALIAS_SCHEMA_TS_VERS_DRIZZLE ou, par défaut, la clé elle-même) est ` +
              `"${nomTableDrizzle}" — alias à mettre à jour, ou dérive réelle du yaml.`
          ).toBe(nomTableDrizzle);
        });
      }

      it(`a une table Drizzle correspondante ("${nomTableDrizzle}")`, () => {
        expect(
          tableDrizzle,
          `Aucune table Drizzle nommée "${nomTableDrizzle}" trouvée dans packages/db/src/schema — ` +
            `nom de table renommé/supprimé côté Postgres, ou résolution FROM incorrecte.`
        ).toBeDefined();
      });

      if (!tableDrizzle) return;

      if (streamCorrespondant) {
        it("yaml et schema.ts déclarent exactement les mêmes colonnes", () => {
          // "id" est une exception volontaire et uniforme, jamais une
          // dérive à signaler : chaque requête du yaml le sélectionne
          // explicitement (nécessaire à PowerSync pour identifier la ligne),
          // mais schema.ts ne le déclare jamais (colonne implicite de
          // PowerSync, voir AUDIT_COLUMNS_EXCLUSION ci-dessus et l'en-tête
          // de schema.ts) — exclu des deux côtés avant comparaison.
          const colonnesYaml = new Set([...streamCorrespondant.colonnes].filter((c) => c !== "id"));
          const manquantesCoteSchemaTs = [...colonnesYaml].filter((c) => !colonnesSchemaTs.has(c));
          const manquantesCoteYaml = [...colonnesSchemaTs].filter((c) => !colonnesYaml.has(c));
          expect(
            manquantesCoteSchemaTs,
            `Colonnes présentes dans le yaml mais absentes de schema.ts pour "${cleSchemaTs}"`
          ).toEqual([]);
          expect(
            manquantesCoteYaml,
            `Colonnes présentes dans schema.ts mais absentes du yaml pour "${cleSchemaTs}"`
          ).toEqual([]);
        });
      }

      it("toute colonne Drizzle est exposée ou explicitement exclue avec justification", () => {
        const colonnesNonExposees = [...tableDrizzle.colonnes].filter(
          (c) => !colonnesSchemaTs.has(c) && justificationPour(nomTableDrizzle, c) === undefined
        );
        expect(
          colonnesNonExposees,
          `Colonnes Drizzle de "${nomTableDrizzle}" ni exposées (schema.ts) ni listées dans EXCLUSIONS ` +
            `avec une justification — décision d'exposition à prendre.`
        ).toEqual([]);
      });

      it("aucune colonne exposée n'est absente de Drizzle (pas de colonne obsolète)", () => {
        const colonnesObsoletes = [...colonnesSchemaTs].filter((c) => !tableDrizzle.colonnes.has(c));
        expect(
          colonnesObsoletes,
          `Colonnes exposées côté schema.ts pour "${cleSchemaTs}" mais absentes de la table Drizzle ` +
            `"${nomTableDrizzle}" — colonne renommée/supprimée côté Postgres, schema.ts/yaml non mis à jour.`
        ).toEqual([]);
      });
    });
  }
});
