import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculerStatutDocument } from "core";
import {
  appartements,
  baux,
  bien,
  candidat,
  depense,
  documents,
  etatsDesLieux,
  garants,
  immeublesLegacy,
  locataires,
  mettreAJourAvecAudit,
  organisationSci,
  scis,
  sinistre,
  type Database
} from "db";
import { and, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { AuditService } from "../audit/audit.service";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import {
  DOCUMENT_ENTITE_TYPES,
  type CreateDocumentDto,
  type DocumentCandidatRole,
  type DocumentCategorie,
  type DocumentEntiteType
} from "./dto/create-document.dto";
import type { RemplacerDocumentDto } from "./dto/remplacer-document.dto";
import type { UpdateDocumentDto } from "./dto/update-document.dto";
import { construireCheminStockage } from "./storage/construire-chemin-stockage";
import { DocumentStorageService } from "../storage/document-storage.service";

export interface FindAllDocumentsFiltres {
  entiteType?: DocumentEntiteType;
  entiteId?: string;
  categorie?: DocumentCategorie;
  statut?: "valide" | "expire" | "archive";
  recherche?: string;
  avecArchives?: boolean;
  candidatRole?: DocumentCandidatRole;
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
    return this.creerDepuisBuffer(dto, fichier.buffer, fichier.originalname, fichier.mimetype, fichier.size);
  }

  // Extrait d'upload() (Module Messagerie, 2026-09-16) : le contenu binaire
  // ne vient pas toujours d'un upload multipart — l'action "Classer dans
  // Documents" d'une pièce jointe de message a déjà le buffer en main
  // (relu depuis le storage via MessagesCommunicationService), sans jamais
  // passer par Express.Multer.File. Même logique de validation/stockage
  // dans les deux cas.
  async creerDepuisBuffer(
    dto: CreateDocumentDto,
    contenu: Buffer,
    nomFichier: string,
    mimeType: string,
    tailleOctets: number
  ) {
    await this.verifierEntiteExiste(dto.entiteType, dto.entiteId);
    this.verifierPieceValideSelonEntiteType(dto.entiteType, dto.etatDesLieuxPieceType, dto.etatDesLieuxPieceNumero);
    this.verifierCandidatRoleSelonEntiteType(dto.entiteType, dto.candidatRole);

    // L'id est généré ici (plutôt que laissé au $defaultFn du schéma) car il
    // fait partie du chemin de stockage — il doit être connu avant l'écriture
    // du blob, pas seulement après l'insertion de la ligne.
    const documentId = uuidv7();
    const cheminStockage = construireCheminStockage(dto.entiteType, dto.entiteId, documentId);
    await this.storage.enregistrer(contenu, cheminStockage);

    const [document] = await this.db
      .insert(documents)
      .values({
        id: documentId,
        entiteType: dto.entiteType,
        entiteId: dto.entiteId,
        categorie: dto.categorie,
        dateExpiration: dto.dateExpiration ?? null,
        nomFichier,
        mimeType,
        tailleOctets,
        cheminStockage,
        etatDesLieuxPieceType: dto.etatDesLieuxPieceType ?? null,
        etatDesLieuxPieceNumero: dto.etatDesLieuxPieceNumero ?? null,
        candidatRole: dto.candidatRole ?? null
      })
      .returning();
    if (!document) {
      throw new Error("Échec de l'enregistrement du document");
    }
    return this.versDto(document);
  }

  // Versioning (docs/backlog.md, dette technique) : crée la nouvelle version
  // chaînée à `documentPrecedentId`, puis archive l'ancienne — dans la même
  // transaction pour ne jamais laisser un état intermédiaire incohérent
  // (nouvelle version créée mais ancienne toujours 'valide', ou l'inverse)
  // si l'une des deux écritures échoue. entiteType/entiteId/le chemin de
  // stockage sont hérités de l'ancienne version, jamais re-saisis. Le blob
  // est écrit sur le storage avant la transaction, même ordre que upload()
  // — le storage n'est de toute façon jamais couvert par une transaction
  // SQL.
  async remplacerDocument(documentPrecedentId: string, dto: RemplacerDocumentDto, fichier: Express.Multer.File) {
    const [ancien] = await this.db.select().from(documents).where(eq(documents.id, documentPrecedentId)).limit(1);
    if (!ancien) {
      throw new NotFoundException("Document à remplacer introuvable");
    }
    // Garde l'invariant "une seule version courante non chaînée par chaîne"
    // (docs/data-dictionary.md, section documents) : on ne remplace jamais
    // une version déjà archivée, qu'elle le soit via un remplacement
    // précédent ou via archiver() manuel — dans ce dernier cas, un nouvel
    // upload sans lien de version reste possible via upload(), jamais
    // bloqué par cette garde.
    if (ancien.archivedAt !== null) {
      throw new ConflictException("Seule la version courante (non archivée) d'un document peut être remplacée.");
    }
    this.verifierPieceValideSelonEntiteType(ancien.entiteType, dto.etatDesLieuxPieceType, dto.etatDesLieuxPieceNumero);

    const documentId = uuidv7();
    const cheminStockage = construireCheminStockage(ancien.entiteType, ancien.entiteId, documentId);
    await this.storage.enregistrer(fichier.buffer, cheminStockage);

    const utilisateurId = this.requestContext.getUtilisateurId();
    return this.db.transaction(async (tx) => {
      const [nouveau] = await tx
        .insert(documents)
        .values({
          id: documentId,
          entiteType: ancien.entiteType,
          entiteId: ancien.entiteId,
          categorie: dto.categorie,
          dateExpiration: dto.dateExpiration ?? null,
          nomFichier: fichier.originalname,
          mimeType: fichier.mimetype,
          tailleOctets: fichier.size,
          cheminStockage,
          etatDesLieuxPieceType: dto.etatDesLieuxPieceType ?? null,
          etatDesLieuxPieceNumero: dto.etatDesLieuxPieceNumero ?? null,
          candidatRole: ancien.candidatRole,
          documentPrecedentId
        })
        .returning();
      if (!nouveau) {
        throw new Error("Échec de l'enregistrement du nouveau document");
      }

      const [archive] = await mettreAJourAvecAudit(
        tx,
        documents,
        documentPrecedentId,
        { archivedAt: new Date(), statut: "archive" },
        utilisateurId
      );
      if (!archive) {
        throw new Error("Échec de l'archivage de l'ancienne version");
      }

      return this.versDto(nouveau);
    });
  }

  // Scoping (chantier scoping multi-organisation, Commit 4, sous-commit 4c,
  // 2026-09-18) : entiteType est un filtre OPTIONNEL au niveau de l'API
  // (DocumentsListView.tsx, l'écran "Documents" global, l'appelle sans
  // filtre — tous types confondus). Deux sous-chemins, jamais un seul
  // pattern généralisé à tort :
  // - entiteType fourni : résolution du seul chemin correspondant (voir
  //   resoudreEntiteIdsOrganisation ci-dessous), puis IN sur entiteId.
  // - entiteType absent : résolution des 11 chemins séparément, combinés
  //   en OR — (entiteType = X AND entiteId IN idsValidesDeX) pour chaque
  //   X — jamais une jointure unique qui supposerait à tort un chemin
  //   commun à toutes les lignes.
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
    if (filtres.candidatRole) {
      conditions.push(eq(documents.candidatRole, filtres.candidatRole));
    }
    if (!filtres.avecArchives) {
      conditions.push(isNull(documents.archivedAt));
    }
    if (filtres.recherche) {
      conditions.push(ilike(documents.nomFichier, `%${filtres.recherche}%`));
    }

    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      if (filtres.entiteType) {
        const idsValides = await this.resoudreEntiteIdsOrganisation(filtres.entiteType, organisationId);
        if (idsValides.length === 0) {
          return [];
        }
        conditions.push(inArray(documents.entiteId, idsValides));
      } else {
        const branchesParType = await Promise.all(
          DOCUMENT_ENTITE_TYPES.map(async (type) => {
            const idsValides = await this.resoudreEntiteIdsOrganisation(type, organisationId);
            return idsValides.length > 0
              ? and(eq(documents.entiteType, type), inArray(documents.entiteId, idsValides))
              : undefined;
          })
        );
        const branches = branchesParType.filter((branche): branche is SQL => branche !== undefined);
        if (branches.length === 0) {
          return [];
        }
        conditions.push(or(...branches) as SQL);
      }
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

  // Une méthode par entiteType, jamais un chemin de jointure généralisé :
  // 6 des 11 cas ont une colonne organisationId propre (locataire, garant,
  // bien, depense, candidat, sinistre), les 5 autres nécessitent une
  // chaîne de jointure jusqu'à bien.organisationId — deux via
  // organisation_sci (sci, immeuble, qui n'ont ni l'un ni l'autre de
  // colonne/FK directe vers une organisation), trois via bien directement
  // (appartement : 1 jointure ; bail : 2 ; etat_des_lieux : 3). Résolution
  // en deux temps (ids valides d'abord, puis IN) comme dans
  // ScisService/ImmeublesService.findAll() (Commit 4a) — jamais problématique
  // à l'échelle réelle de l'application (~20 logements, vérifié en base de
  // dev : 4 lignes au maximum dans n'importe laquelle des tables cibles).
  private async resoudreEntiteIdsOrganisation(
    entiteType: DocumentEntiteType,
    organisationId: string
  ): Promise<string[]> {
    switch (entiteType) {
      case "sci": {
        const lignes = await this.db
          .select({ id: organisationSci.sciId })
          .from(organisationSci)
          .where(eq(organisationSci.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "immeuble": {
        const sciIds = await this.resoudreEntiteIdsOrganisation("sci", organisationId);
        if (sciIds.length === 0) {
          return [];
        }
        const lignes = await this.db
          .select({ id: immeublesLegacy.id })
          .from(immeublesLegacy)
          .where(inArray(immeublesLegacy.sciId, sciIds));
        return lignes.map((ligne) => ligne.id);
      }
      case "appartement": {
        const lignes = await this.db
          .select({ id: appartements.id })
          .from(appartements)
          .innerJoin(bien, eq(bien.id, appartements.bienId))
          .where(eq(bien.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "locataire": {
        const lignes = await this.db
          .select({ id: locataires.id })
          .from(locataires)
          .where(eq(locataires.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "bail": {
        const lignes = await this.db
          .select({ id: baux.id })
          .from(baux)
          .innerJoin(appartements, eq(appartements.id, baux.appartementId))
          .innerJoin(bien, eq(bien.id, appartements.bienId))
          .where(eq(bien.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "etat_des_lieux": {
        const lignes = await this.db
          .select({ id: etatsDesLieux.id })
          .from(etatsDesLieux)
          .innerJoin(baux, eq(baux.id, etatsDesLieux.bailId))
          .innerJoin(appartements, eq(appartements.id, baux.appartementId))
          .innerJoin(bien, eq(bien.id, appartements.bienId))
          .where(eq(bien.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "garant": {
        const lignes = await this.db
          .select({ id: garants.id })
          .from(garants)
          .where(eq(garants.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "bien": {
        const lignes = await this.db.select({ id: bien.id }).from(bien).where(eq(bien.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "depense": {
        const lignes = await this.db
          .select({ id: depense.id })
          .from(depense)
          .where(eq(depense.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "candidat": {
        const lignes = await this.db
          .select({ id: candidat.id })
          .from(candidat)
          .where(eq(candidat.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
      case "sinistre": {
        const lignes = await this.db
          .select({ id: sinistre.id })
          .from(sinistre)
          .where(eq(sinistre.organisationId, organisationId));
        return lignes.map((ligne) => ligne.id);
      }
    }
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
    // Contrôle d'appartenance (Commit B4, chantier scoping multi-organisation,
    // 2026-09-18) : réutilise resoudreEntiteIdsOrganisation (Sous-commit 4c)
    // plutôt que de dupliquer les 11 chemins de résolution — même message
    // que le document inexistant ci-dessus, avant tout déchiffrement.
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const idsValides = await this.resoudreEntiteIdsOrganisation(document.entiteType, organisationId);
      if (!idsValides.includes(document.entiteId)) {
        throw new NotFoundException("Document introuvable");
      }
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
      candidatRole: document.candidatRole,
      documentPrecedentId: document.documentPrecedentId,
      statut: calculerStatutDocument(document.dateExpiration, document.archivedAt !== null, dateReference)
    };
  }

  // Partagé entre upload() et remplacerDocument() : etatDesLieuxPieceType/
  // Numero n'ont de sens que pour entiteType = 'etat_des_lieux' (voir
  // docs/data-dictionary.md, section documents).
  private verifierPieceValideSelonEntiteType(
    entiteType: DocumentEntiteType,
    etatDesLieuxPieceType: string | undefined,
    etatDesLieuxPieceNumero: number | undefined
  ): void {
    if ((etatDesLieuxPieceType || etatDesLieuxPieceNumero !== undefined) && entiteType !== "etat_des_lieux") {
      throw new BadRequestException(
        "etatDesLieuxPieceType/etatDesLieuxPieceNumero ne sont valables que pour entiteType 'etat_des_lieux'."
      );
    }
  }

  // Distingue un document du candidat de celui de son garant (extension
  // checklist candidat, 2026-09-15) — obligatoire pour entiteType =
  // 'candidat' (sinon impossible de savoir à qui il appartient), interdit
  // pour les 6 autres entiteType (voir packages/db/src/schema/documents.ts).
  private verifierCandidatRoleSelonEntiteType(
    entiteType: DocumentEntiteType,
    candidatRole: DocumentCandidatRole | undefined
  ): void {
    if (entiteType === "candidat" && !candidatRole) {
      throw new BadRequestException("candidatRole est obligatoire pour entiteType 'candidat'.");
    }
    if (candidatRole && entiteType !== "candidat") {
      throw new BadRequestException("candidatRole n'est valable que pour entiteType 'candidat'.");
    }
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
            .select({ id: immeublesLegacy.id })
            .from(immeublesLegacy)
            .where(eq(immeublesLegacy.id, entiteId))
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
        case "garant":
          return this.db.select({ id: garants.id }).from(garants).where(eq(garants.id, entiteId)).limit(1);
        // Migration bien (2026-08-26, docs/backlog.md) : sans ce cas, aucun
        // document ne peut se rattacher à un bien non-immeuble (maison,
        // parking, bureau, local_commercial), ni à un immeuble créé après
        // cette date via BienService — 'immeuble' ci-dessus reste réservé
        // aux documents déjà rattachés à une ligne immeubles existante.
        case "bien":
          return this.db.select({ id: bien.id }).from(bien).where(eq(bien.id, entiteId)).limit(1);
        // Module Charges et fiscalité, Étape 1 (2026-09-06, docs/backlog.md) :
        // permet de rattacher un document à une dépense — aucun flux
        // d'upload réel n'existe encore pour ce cas.
        case "depense":
          return this.db.select({ id: depense.id }).from(depense).where(eq(depense.id, entiteId)).limit(1);
        // Module Calendrier/Candidats (2026-09-15) : pièces jointes d'un
        // candidat locataire.
        case "candidat":
          return this.db.select({ id: candidat.id }).from(candidat).where(eq(candidat.id, entiteId)).limit(1);
        // Module Suivi sinistre et assurance (2026-09-16) : photos, rapport
        // d'expertise, courriers assureur.
        case "sinistre":
          return this.db.select({ id: sinistre.id }).from(sinistre).where(eq(sinistre.id, entiteId)).limit(1);
      }
    })();
    if (!ligne) {
      throw new NotFoundException(
        `Aucune entité de type '${entiteType}' avec l'id fourni : impossible d'y rattacher un document.`
      );
    }
  }
}
