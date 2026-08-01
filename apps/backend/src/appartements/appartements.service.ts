import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { appartements, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateAppartementDto } from "./dto/create-appartement.dto";
import type { UpdateAppartementDto } from "./dto/update-appartement.dto";

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
    return appartement;
  }

  async findAll(immeubleId?: string) {
    if (immeubleId) {
      return this.db.select().from(appartements).where(eq(appartements.immeubleId, immeubleId));
    }
    return this.db.select().from(appartements);
  }

  async findById(id: string) {
    const [appartement] = await this.db
      .select()
      .from(appartements)
      .where(eq(appartements.id, id))
      .limit(1);
    return appartement ?? null;
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
    return appartement;
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
    return appartement;
  }
}
