import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculerStatutDocument } from "core";
import {
  appartements,
  baux,
  documents,
  etatsDesLieux,
  immeubles,
  locataires,
  mettreAJourAvecAudit,
  scis,
  type Database
} from "db";
import { and, eq, ilike, isNull, type SQL } from "drizzle-orm";
import { AuditService } from "../audit/audit.service";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateDocumentDto, DocumentCategorie, DocumentEntiteType } from "./dto/create-document.dto";
import type { UpdateDocumentDto } from "./dto/update-document.dto";
import { DocumentStorageService } from "./storage/document-storage.service";

export interface FindAllDocumentsFiltres {
  entiteType?: DocumentEntiteType;
  entiteId?: string;
  categorie?: DocumentCategorie;
  statut?: "valide" | "expire" | "archive";
  recherche?: string;
  avecArchives?: boolean;
}

type DocumentRow = typeof documents.$inferSelect;

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storage: DocumentStorageService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService
  ) {}

  async upload(dto: CreateDocumentDto, fichier: Express.Multer.File) {
    await this.verifierEntiteExiste(dto.entiteType, dto.entiteId);
    if ((dto.etatDesLieuxPieceType || dto.etatDesLieuxPieceNumero !== undefined) && dto.entiteType !== "etat_des_lieux") {
      throw new BadRequestException(
        "etatDesLieuxPieceType/etatDesLieuxPieceNumero ne sont valables que pour entiteType 'etat_des_lieux'."
      );
    }

    const cheminStockage = await this.storage.enregistrer(fichier.buffer);

    const [document] = await this.db
      .insert(documents)
      .values({
        entiteType: dto.entiteType,
        entiteId: dto.entiteId,
        categorie: dto.categorie,
        dateExpiration: dto.dateExpiration ?? null,
        nomFichier: fichier.originalname,
        mimeType: fichier.mimetype,
        tailleOctets: fichier.size,
        cheminStockage,
        etatDesLieuxPieceType: dto.etatDesLieuxPieceType ?? null,
        etatDesLieuxPieceNumero: dto.etatDesLieuxPieceNumero ?? null
      })
      .returning();
    if (!document) {
      throw new Error("Échec de l'enregistrement du document");
    }
    return this.versDto(document);
  }

  async findAll(filtres: FindAllDocumentsFiltres) {
    const conditions: SQL[] = [];
    if (filtres.entiteType) {
      conditions.push(eq(documents.entiteType, filtres.entiteType));
    }
    if (filtres.entiteId) {
      conditions.push(eq(documents.entiteId, filtres.entiteId));
    }
    if (filtres.categorie) {
      conditions.push(eq(documents.categorie, filtres.categorie));
    }
    if (!filtres.avecArchives) {
      conditions.push(isNull(documents.archivedAt));
    }
    if (filtres.recherche) {
      conditions.push(ilike(documents.nomFichier, `%${filtres.recherche}%`));
    }

    const lignes = await this.db
      .select()
      .from(documents)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const enrichis = lignes.map((ligne) => this.versDto(ligne));
    if (filtres.statut) {
      return enrichis.filter((document) => document.statut === filtres.statut);
    }
    return enrichis;
  }

  async findById(id: string) {
    const [document] = await this.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    return document ? this.versDto(document) : null;
  }

  async update(id: string, dto: UpdateDocumentDto) {
    const [document] = await mettreAJourAvecAudit(
      this.db,
      documents,
      id,
      { categorie: dto.categorie, dateExpiration: dto.dateExpiration },
      this.requestContext.getUtilisateurId()
    );
    if (!document) {
      throw new NotFoundException("Document introuvable");
    }
    // mettreAJourAvecAudit est générique sur T extends TableAvecAudit : son
    // type de retour inféré élargit les colonnes propres à `documents`
    // (au-delà d'id/version/updatedAt/updatedBy) — la ligne existe bel et
    // bien avec sa forme complète (WHERE id = ... vient de matcher), ce cast
    // ne fait que rétablir un type déjà correct à l'exécution.
    return this.versDto(document as DocumentRow);
  }

  async archiver(id: string) {
    const [document] = await mettreAJourAvecAudit(
      this.db,
      documents,
      id,
      { archivedAt: new Date(), statut: "archive" },
      this.requestContext.getUtilisateurId()
    );
    if (!document) {
      throw new NotFoundException("Document introuvable");
    }
    return this.versDto(document as DocumentRow);
  }

  // Seul point de déchiffrement du contenu d'un document — chaque appel
  // consigne un accès à un document sensible dans journal_audit (CLAUDE.md,
  // même mécanisme que l'IBAN/BIC, AuditService.logAccesDocumentSensible).
  async telecharger(id: string): Promise<{ contenu: Buffer; document: DocumentRow }> {
    const [document] = await this.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!document) {
      throw new NotFoundException("Document introuvable");
    }
    const contenu = await this.storage.lire(document.cheminStockage);
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      await this.auditService.logAccesDocumentSensible({ entiteId: document.id, utilisateurId });
    }
    return { contenu, document };
  }

  // Projection explicite plutôt qu'un spread de la ligne brute :
  // chemin_stockage (clé interne de stockage, disque ou bucket selon
  // DocumentStorageService) ne doit jamais atteindre le frontend — un
  // spread laisserait passer silencieusement tout futur champ interne
  // ajouté à la table, sans qu'on ait à y repenser ici.
  private versDto(document: DocumentRow) {
    const dateReference = new Date().toISOString().slice(0, 10);
    return {
      id: document.id,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      updatedBy: document.updatedBy,
      version: document.version,
      archivedAt: document.archivedAt,
      entiteType: document.entiteType,
      entiteId: document.entiteId,
      categorie: document.categorie,
      dateExpiration: document.dateExpiration,
      nomFichier: document.nomFichier,
      mimeType: document.mimeType,
      tailleOctets: document.tailleOctets,
      etatDesLieuxPieceType: document.etatDesLieuxPieceType,
      etatDesLieuxPieceNumero: document.etatDesLieuxPieceNumero,
      statut: calculerStatutDocument(document.dateExpiration, document.archivedAt !== null, dateReference)
    };
  }

  // Le lien polymorphe n'a pas de contrainte de clé étrangère possible
  // (5 tables cibles) : cette vérification applicative en tient lieu.
  private async verifierEntiteExiste(entiteType: DocumentEntiteType, entiteId: string): Promise<void> {
    const [ligne] = await (() => {
      switch (entiteType) {
        case "sci":
          return this.db.select({ id: scis.id }).from(scis).where(eq(scis.id, entiteId)).limit(1);
        case "immeuble":
          return this.db
            .select({ id: immeubles.id })
            .from(immeubles)
            .where(eq(immeubles.id, entiteId))
            .limit(1);
        case "appartement":
          return this.db
            .select({ id: appartements.id })
            .from(appartements)
            .where(eq(appartements.id, entiteId))
            .limit(1);
        case "locataire":
          return this.db
            .select({ id: locataires.id })
            .from(locataires)
            .where(eq(locataires.id, entiteId))
            .limit(1);
        case "bail":
          return this.db.select({ id: baux.id }).from(baux).where(eq(baux.id, entiteId)).limit(1);
        case "etat_des_lieux":
          return this.db
            .select({ id: etatsDesLieux.id })
            .from(etatsDesLieux)
            .where(eq(etatsDesLieux.id, entiteId))
            .limit(1);
      }
    })();
    if (!ligne) {
      throw new NotFoundException(
        `Aucune entité de type '${entiteType}' avec l'id fourni : impossible d'y rattacher un document.`
      );
    }
  }
}
