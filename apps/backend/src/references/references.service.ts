import { Injectable, NotFoundException } from "@nestjs/common";
import { DocumentStorageService } from "../storage/document-storage.service";

interface ReferenceDocument {
  chemin: string;
  nomFichier: string;
  mimeType: string;
}

// Fichiers fixes, publics, partagés par toute l'app — jamais rattachés à
// une entité (bail/locataire/etc.) comme les documents du module
// Documents, jamais chiffrés (aucune donnée utilisateur, texte légal
// public — voir docs/backlog.md, section "Édition d'un bail",
// notice d'information). Stockés sous le préfixe references/, en dehors
// de documents/<entiteType>/<entiteId>/ (construireCheminStockage.ts).
const REFERENCES: Record<string, ReferenceDocument> = {
  "notice-information-bail": {
    chemin: "references/notice-information-bail.pdf",
    nomFichier: "notice-information-bail.pdf",
    mimeType: "application/pdf"
  }
};

@Injectable()
export class ReferencesService {
  constructor(private readonly storage: DocumentStorageService) {}

  async telecharger(slug: string): Promise<{ contenu: Buffer; nomFichier: string; mimeType: string }> {
    const reference = REFERENCES[slug];
    if (!reference) {
      throw new NotFoundException("Document de référence introuvable");
    }
    const contenu = await this.storage.lire(reference.chemin, { chiffrer: false });
    return { contenu, nomFichier: reference.nomFichier, mimeType: reference.mimeType };
  }
}
