import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { appartements, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateAppartementDto } from "./dto/create-appartement.dto";
import type { UpdateAppartementDto } from "./dto/update-appartement.dto";

type AppartementRow = typeof appartements.$inferSelect;

@Injectable()
export class AppartementsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateAppartementDto) {
    const [appartement] = await this.db
      .insert(appartements)
      .values({
        immeubleId: dto.immeubleId,
        numero: dto.numero,
        type: dto.type,
        surface: dto.surface,
        loyerReference: dto.loyerReference,
        nombrePiecesPrincipales: dto.nombrePiecesPrincipales,
        modeChauffage: dto.modeChauffage,
        modeEauChaude: dto.modeEauChaude
      })
      .returning();
    if (!appartement) {
      throw new Error("Échec de la création de l'appartement");
    }
    return this.versDto(appartement);
  }

  async findAll(immeubleId?: string) {
    const lignes = immeubleId
      ? await this.db.select().from(appartements).where(eq(appartements.immeubleId, immeubleId))
      : await this.db.select().from(appartements);
    return lignes.map((appartement) => this.versDto(appartement));
  }

  async findById(id: string) {
    const [appartement] = await this.db
      .select()
      .from(appartements)
      .where(eq(appartements.id, id))
      .limit(1);
    return appartement ? this.versDto(appartement) : null;
  }

  async update(id: string, dto: UpdateAppartementDto) {
    const [appartement] = await mettreAJourAvecAudit(
      this.db,
      appartements,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }
    return this.versDto(appartement as AppartementRow);
  }

  async archive(id: string) {
    const [appartement] = await mettreAJourAvecAudit(
      this.db,
      appartements,
      id,
      { statut: "archive", archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }
    return this.versDto(appartement as AppartementRow);
  }

  // identifiant_fiscal (donnée fiscale nominative, packages/db/src/schema/
  // appartements.ts) n'est ni exposé ici ni réplicable par le Sync Stream
  // appartements (docs/backlog.md, chantier PowerSync) — aucun DTO
  // create/update ne permet de le saisir aujourd'hui, et aucun code
  // frontend n'en dépend en lecture.
  private versDto(appartement: AppartementRow) {
    return {
      id: appartement.id,
      createdAt: appartement.createdAt,
      updatedAt: appartement.updatedAt,
      updatedBy: appartement.updatedBy,
      version: appartement.version,
      archivedAt: appartement.archivedAt,
      immeubleId: appartement.immeubleId,
      numero: appartement.numero,
      type: appartement.type,
      surface: appartement.surface,
      loyerReference: appartement.loyerReference,
      nombrePiecesPrincipales: appartement.nombrePiecesPrincipales,
      modeChauffage: appartement.modeChauffage,
      modeEauChaude: appartement.modeEauChaude,
      typeEnergie: appartement.typeEnergie,
      equipementCuisine: appartement.equipementCuisine,
      dependancesAnnexes: appartement.dependancesAnnexes,
      nombreChambres: appartement.nombreChambres,
      nombreSallesDeBain: appartement.nombreSallesDeBain,
      nombreWc: appartement.nombreWc,
      autrePiece1: appartement.autrePiece1,
      autrePiece2: appartement.autrePiece2,
      statut: appartement.statut
    };
  }
}
