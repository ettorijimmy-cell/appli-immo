import { basename, join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Sous-dossier applicatif dédié sous app.getPath("temp") — jamais le
// dossier temp système racine directement, pour que viderDossierTemporaire
// ci-dessous ne puisse jamais supprimer autre chose que nos propres
// fichiers.
export const DOSSIER_TEMP_DOCUMENTS = "appli-immo-docs-temp";

// Défense en profondeur (même principe que la validation de protocole sur
// shell:openExternal, main/index.ts) : le nom de fichier vient du renderer
// (lui-même dérivé de l'en-tête Content-Disposition d'une réponse HTTP),
// jamais fait confiance tel quel avant d'écrire quoi que ce soit sur
// disque. basename() élimine tout séparateur de chemin (protection contre
// un nomFichier du type "../../evil.docx") avant même de vérifier
// l'extension.
export function validerNomFichierDocx(nomFichier: string): string {
  const nom = basename(nomFichier);
  if (!nom.toLowerCase().endsWith(".docx")) {
    throw new Error(`Extension non autorisée pour l'ouverture directe : "${nom}" doit se terminer par .docx`);
  }
  return nom;
}

// Écrit le buffer dans un sous-dossier unique (uuid) du dossier temporaire
// dédié : le fichier reste en clair sur disque tant que l'application
// associée (Word, LibreOffice...) le garde ouvert — decision actée, aucune
// suppression immédiate après ouverture (voir viderDossierTemporaire
// ci-dessous, appelé uniquement au démarrage suivant). Un sous-dossier par
// appel évite qu'une seconde ouverture du même document (même nomFichier,
// ex. régénéré après correction) n'entre en conflit avec la première
// pendant qu'elle est encore verrouillée par l'application externe.
export async function ecrireFichierTemporaire(
  dossierTempRacine: string,
  nomFichier: string,
  contenu: Buffer
): Promise<string> {
  const nom = validerNomFichierDocx(nomFichier);
  const dossierSession = join(dossierTempRacine, DOSSIER_TEMP_DOCUMENTS, randomUUID());
  await mkdir(dossierSession, { recursive: true });
  const chemin = join(dossierSession, nom);
  await writeFile(chemin, contenu);
  return chemin;
}

// Purge complète (jamais partielle ni différée) du dossier temporaire dédié
// — appelée une seule fois, au démarrage de l'app, avant toute nouvelle
// écriture (voir main/index.ts, app.whenReady()). Les fichiers de la
// session précédente ne sont jamais nettoyés à la fermeture de
// l'application associée (aucun moyen fiable de détecter cette fermeture
// depuis le processus principal) ni immédiatement après ouverture (Word
// garderait alors un fichier supprimé sous les pieds) : le seul moment sûr
// est donc le prochain lancement. { force: true } : ne jamais échouer si
// le dossier n'existe pas encore (premier lancement).
export async function viderDossierTemporaire(dossierTempRacine: string): Promise<void> {
  await rm(join(dossierTempRacine, DOSSIER_TEMP_DOCUMENTS), { recursive: true, force: true });
}
