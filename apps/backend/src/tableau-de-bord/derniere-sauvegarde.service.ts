import { readdir } from "fs/promises";
import path from "path";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

// Nom de fichier posé par scripts/backup-local.mjs : appli_immo_dev_AAAAMMJJ-HHMMSS.sql
const NOM_FICHIER_SAUVEGARDE = /^appli_immo_dev_(\d{8})-(\d{6})\.sql$/;

@Injectable()
export class DerniereSauvegardeService {
  private readonly backupsDir: string;

  constructor(config: ConfigService) {
    this.backupsDir = config.get<string>("BACKUPS_DIR") ?? path.join(process.cwd(), "..", "..", "backups");
  }

  async getDerniereSauvegarde(): Promise<{ dateIso: string | null }> {
    let fichiers: string[];
    try {
      fichiers = await readdir(this.backupsDir);
    } catch {
      return { dateIso: null };
    }

    let plusRecent: string | null = null;
    for (const fichier of fichiers) {
      const correspondance = NOM_FICHIER_SAUVEGARDE.exec(fichier);
      if (!correspondance) {
        continue;
      }
      const [, jour, heure] = correspondance;
      const dateIso = `${jour!.slice(0, 4)}-${jour!.slice(4, 6)}-${jour!.slice(6, 8)}T${heure!.slice(0, 2)}:${heure!.slice(2, 4)}:${heure!.slice(4, 6)}`;
      if (!plusRecent || dateIso > plusRecent) {
        plusRecent = dateIso;
      }
    }
    return { dateIso: plusRecent };
  }
}
