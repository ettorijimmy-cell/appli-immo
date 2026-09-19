import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculerMontantRecuTotal, montantEnCentimes } from "core";
import { appartements, baux, bien, mettreAJourAvecAudit, paiements, remboursements, versements, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { AuditService } from "../audit/audit.service";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { DocumentStorageService } from "../storage/document-storage.service";
import type { CreateRemboursementDto } from "./dto/create-remboursement.dto";
import { construireCheminPieceJustificative } from "./storage/construire-chemin-piece-justificative";

type RemboursementRow = typeof remboursements.$inferSelect;

@Injectable()
export class RemboursementsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storage: DocumentStorageService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService
  ) {}

  // remboursements n'a pas de colonne organisationId directe : le scoping
  // passe par une triple jointure remboursements -> baux -> appartements ->
  // bien (bien.organisationId), même profondeur que PaiementsService.
  async findAll(bailId?: string) {
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const conditions = [
        eq(bien.organisationId, organisationId),
        ...(bailId ? [eq(remboursements.bailId, bailId)] : [])
      ];
      const rows = await this.db
        .select({ remboursement: remboursements })
        .from(remboursements)
        .innerJoin(baux, eq(baux.id, remboursements.bailId))
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(...conditions));
      return rows.map((row) => this.versDto(row.remboursement));
    }
    const lignes = bailId
      ? await this.db.select().from(remboursements).where(eq(remboursements.bailId, bailId))
      : await this.db.select().from(remboursements);
    return lignes.map((remboursement) => this.versDto(remboursement));
  }

  // Toujours un acte humain explicite (docs/data-dictionary.md, section
  // "versements & remboursements") : ni resilier() ni aucun autre service
  // ne crée de remboursement seul. Si paiementId est renseigné, valide que
  // la somme des remboursements déjà actifs pour ce paiement + celui-ci ne
  // dépasse JAMAIS le montant réellement reçu sur ce paiement (versements
  // actifs) — rejet strict (ConflictException), sans exception, décision
  // tranchée avec l'utilisateur avant tout code.
  async create(dto: CreateRemboursementDto, fichier?: Express.Multer.File) {
    // Vérifié avant toute écriture de fichier (même raison que
    // DocumentsService.upload() -> verifierEntiteExiste()) : sans ce garde,
    // un bailId invalide laissait storage.enregistrer() écrire un blob
    // chiffré orphelin avant que l'insert échoue sur la contrainte FK
    // (financial-logic-reviewer, 2026-08-24).
    const [bail] = await this.db.select({ id: baux.id }).from(baux).where(eq(baux.id, dto.bailId)).limit(1);
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }

    if (dto.paiementId) {
      const [paiement] = await this.db.select().from(paiements).where(eq(paiements.id, dto.paiementId)).limit(1);
      if (!paiement) {
        throw new NotFoundException("Paiement introuvable");
      }

      const versementsActifs = await this.db
        .select()
        .from(versements)
        .where(and(eq(versements.paiementId, dto.paiementId), isNull(versements.archivedAt)));
      const montantRecu = calculerMontantRecuTotal(versementsActifs);

      const remboursementsExistants = await this.db
        .select()
        .from(remboursements)
        .where(and(eq(remboursements.paiementId, dto.paiementId), isNull(remboursements.archivedAt)));
      const centimesDejaRembourses = remboursementsExistants.reduce(
        (total, r) => total + montantEnCentimes(r.montantRembourse),
        0
      );

      if (centimesDejaRembourses + montantEnCentimes(dto.montantRembourse) > montantEnCentimes(montantRecu)) {
        throw new ConflictException(
          "Le total des remboursements ne peut pas dépasser le montant réellement reçu sur ce paiement."
        );
      }
    }

    // Motif de retenue + pièce jointe (docs/backlog.md, motif de retenue
    // dépôt de garantie) : requis ensemble uniquement pour une retenue
    // réelle sur dépôt de garantie, toujours absents sinon — décision
    // tranchée avec l'utilisateur avant tout code, aucune exception.
    const retenueReelle =
      dto.type === "depot_garantie" && montantEnCentimes(dto.montantRembourse) < montantEnCentimes(dto.montantOrigine);
    if (retenueReelle && (!dto.motifRetenue || !fichier)) {
      throw new BadRequestException(
        "Un motif de retenue et un justificatif sont requis lorsque le montant remboursé est inférieur au montant reçu."
      );
    }
    if (!retenueReelle && (dto.motifRetenue || fichier)) {
      throw new BadRequestException(
        "Motif de retenue et justificatif ne sont valables que pour un remboursement de dépôt de garantie avec retenue (montant remboursé inférieur au montant reçu)."
      );
    }

    let pieceJustificative: {
      chemin: string;
      nomFichier: string;
      mimeType: string;
      tailleOctets: number;
    } | null = null;
    const remboursementId = uuidv7();
    if (retenueReelle && fichier) {
      const chemin = construireCheminPieceJustificative(remboursementId);
      await this.storage.enregistrer(fichier.buffer, chemin, { chiffrer: true });
      pieceJustificative = {
        chemin,
        nomFichier: fichier.originalname,
        mimeType: fichier.mimetype,
        tailleOctets: fichier.size
      };
    }

    const [remboursement] = await this.db
      .insert(remboursements)
      .values({
        id: remboursementId,
        bailId: dto.bailId,
        paiementId: dto.paiementId ?? null,
        type: dto.type,
        montantOrigine: dto.montantOrigine,
        montantRembourse: dto.montantRembourse,
        commentaire: dto.commentaire ?? null,
        dateRemboursement: dto.dateRemboursement,
        mode: dto.mode,
        motifRetenue: dto.motifRetenue ?? null,
        pieceJustificativeChemin: pieceJustificative?.chemin ?? null,
        pieceJustificativeNomFichier: pieceJustificative?.nomFichier ?? null,
        pieceJustificativeMimeType: pieceJustificative?.mimeType ?? null,
        pieceJustificativeTailleOctets: pieceJustificative?.tailleOctets ?? null
      })
      .returning();
    if (!remboursement) {
      throw new Error("Échec de la création du remboursement");
    }
    return this.versDto(remboursement);
  }

  async archive(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3b, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19) : réutilise
    // verifierAppartenanceRemboursement() (Commit B5), déjà partagée avec
    // telechargerPieceJustificative().
    await this.verifierAppartenanceRemboursement(id, "Remboursement introuvable");

    const [remboursement] = await mettreAJourAvecAudit(
      this.db,
      remboursements,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!remboursement) {
      throw new NotFoundException("Remboursement introuvable");
    }
    return this.versDto(remboursement as RemboursementRow);
  }

  // Seul point de déchiffrement de la pièce justificative — même mécanisme
  // d'audit que DocumentsService.telecharger() : donnée personnelle
  // sensible (photo de dégradation, devis...), chaque accès est consigné.
  async telechargerPieceJustificative(
    id: string
  ): Promise<{ contenu: Buffer; nomFichier: string; mimeType: string }> {
    const [remboursement] = await this.db.select().from(remboursements).where(eq(remboursements.id, id)).limit(1);
    if (!remboursement || !remboursement.pieceJustificativeChemin) {
      throw new NotFoundException("Pièce justificative introuvable");
    }
    await this.verifierAppartenanceRemboursement(remboursement.id, "Pièce justificative introuvable");
    const contenu = await this.storage.lire(remboursement.pieceJustificativeChemin, { chiffrer: true });
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      await this.auditService.logAccesDonneeSensible({
        entiteType: "remboursement_piece_justificative",
        entiteId: remboursement.id,
        utilisateurId
      });
    }
    return {
      contenu,
      nomFichier: remboursement.pieceJustificativeNomFichier ?? "piece-justificative",
      mimeType: remboursement.pieceJustificativeMimeType ?? "application/octet-stream"
    };
  }

  // Contrôle d'appartenance (Commit B5, chantier scoping multi-organisation,
  // 2026-09-18) : même chemin de jointure que findAll() (remboursements ->
  // baux -> appartements -> bien). `message` paramétré (Priorité 3b,
  // 2026-09-19) : telechargerPieceJustificative() a besoin de "Pièce
  // justificative introuvable" (même message que son propre garde sur
  // pieceJustificativeChemin absent, juste au-dessus), archive() a besoin de
  // "Remboursement introuvable" (même message que le `!remboursement`
  // ci-dessous, atteint hors contexte HTTP) — dans les deux cas, jamais de
  // distinction observable entre "introuvable" et "d'une autre organisation".
  private async verifierAppartenanceRemboursement(remboursementId: string, message: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
    const [ligne] = await this.db
      .select({ id: remboursements.id })
      .from(remboursements)
      .innerJoin(baux, eq(baux.id, remboursements.bailId))
      .innerJoin(appartements, eq(appartements.id, baux.appartementId))
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(and(eq(remboursements.id, remboursementId), eq(bien.organisationId, organisationId)))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException(message);
    }
  }

  // commentaire est exclu du Sync Stream remboursements (texte libre non
  // maîtrisé, réplication locale non chiffrée) mais reste légitimement
  // exposé ici : affiché dans BailTabs.tsx (app desktop authentifiée) —
  // deux décisions distinctes, confirmé avec l'utilisateur.
  // pieceJustificativeChemin (clé de stockage interne) n'est en revanche
  // jamais exposé, ici ni dans le Sync Stream — même règle que
  // documents.cheminStockage.
  private versDto(remboursement: RemboursementRow) {
    return {
      id: remboursement.id,
      createdAt: remboursement.createdAt,
      updatedAt: remboursement.updatedAt,
      updatedBy: remboursement.updatedBy,
      version: remboursement.version,
      archivedAt: remboursement.archivedAt,
      bailId: remboursement.bailId,
      paiementId: remboursement.paiementId,
      type: remboursement.type,
      montantOrigine: remboursement.montantOrigine,
      montantRembourse: remboursement.montantRembourse,
      commentaire: remboursement.commentaire,
      dateRemboursement: remboursement.dateRemboursement,
      mode: remboursement.mode,
      motifRetenue: remboursement.motifRetenue,
      pieceJustificativeNomFichier: remboursement.pieceJustificativeNomFichier,
      pieceJustificativeMimeType: remboursement.pieceJustificativeMimeType,
      pieceJustificativeTailleOctets: remboursement.pieceJustificativeTailleOctets
    };
  }
}
