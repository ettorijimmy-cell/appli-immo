import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Script réutilisable (pas jetable) : à relancer à chaque nouvelle version
// de la notice d'information (ex. futur arrêté modifiant l'arrêté du
// 29 mai 2015 — voir docs/backlog.md, section "Édition d'un bail").
//
// Réplique volontairement, en miroir simplifié, la bascule S3/disque local
// de DocumentStorageService (apps/backend/src/documents/storage) plutôt que
// de bootstrapper un contexte NestJS ici : tsx (esbuild) n'émet pas
// correctement les métadonnées de décorateurs nécessaires à l'injection
// par type de NestJS (constaté : ConfigService reçu `undefined` dans
// EncryptionService malgré `reflect-metadata` importé en premier) — tous
// les autres scripts de ce dossier accèdent directement à process.env pour
// la même raison, jamais via ConfigService. Cette version reste plus simple
// que l'originale : jamais de chiffrement (texte légal public, voir
// ReferencesService), donc pas besoin d'EncryptionService non plus.
const SCALEWAY_REGION = "fr-par";
const CHEMIN_STOCKAGE = "references/notice-information-bail.pdf";

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

async function main(): Promise<void> {
  const cheminSource =
    parseArg("fichier") ?? path.join(process.cwd(), "..", "..", "tmp", "notice-information.pdf");
  const contenu = await readFile(cheminSource);

  const accessKeyId = process.env["OBJECT_STORAGE_ACCESS_KEY"];
  const secretAccessKey = process.env["OBJECT_STORAGE_SECRET_KEY"];
  const bucket = process.env["OBJECT_STORAGE_BUCKET_NAME"];

  if (accessKeyId && secretAccessKey && bucket) {
    const client = new S3Client({
      region: SCALEWAY_REGION,
      endpoint: `https://s3.${SCALEWAY_REGION}.scw.cloud`,
      credentials: { accessKeyId, secretAccessKey }
    });
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: CHEMIN_STOCKAGE, Body: contenu }));
    console.log(`Notice d'information envoyée vers le bucket ${bucket}, clé ${CHEMIN_STOCKAGE} (${contenu.length} octets, depuis ${cheminSource}).`);
  } else {
    const localStorageDir =
      process.env["DOCUMENTS_STORAGE_DIR"] ?? path.join(process.cwd(), "storage", "documents");
    const cheminAbsolu = path.join(localStorageDir, CHEMIN_STOCKAGE);
    await mkdir(path.dirname(cheminAbsolu), { recursive: true });
    await writeFile(cheminAbsolu, contenu);
    console.log(`OBJECT_STORAGE_* absentes — écrit en local : ${cheminAbsolu} (${contenu.length} octets, depuis ${cheminSource}).`);
  }
}

void main();
