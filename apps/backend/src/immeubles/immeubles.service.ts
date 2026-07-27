import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { immeubles, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateImmeubleDto } from "./dto/create-immeuble.dto";
import type { UpdateImmeubleDto } from "./dto/update-immeuble.dto";

@Injectable()
export class ImmeublesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateImmeubleDto) {
    const [immeuble] = await this.db
      .insert(immeubles)
      .values({
        sciId: dto.sciId,
        nom: dto.nom,
        adresse: dto.adresse,
        codePostal: dto.codePostal,
        ville: dto.ville
      })
      .returning();
    if (!immeuble) {
      throw new Error("Échec de la création de l'immeuble");
    }
    return immeuble;
  }

  async findAll(sciId?: string) {
    if (sciId) {
      return this.db.select().from(immeubles).where(eq(immeubles.sciId, sciId));
    }
    return this.db.select().from(immeubles);
  }

  async findById(id: string) {
    const [immeuble] = await this.db.select().from(immeubles).where(eq(immeubles.id, id)).limit(1);
    return immeuble ?? null;
  }

  async update(id: string, dto: UpdateImmeubleDto) {
    const [immeuble] = await mettreAJourAvecAudit(
      this.db,
      immeubles,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!immeuble) {
      throw new NotFoundException("Immeuble introuvable");
    }
    return immeuble;
  }

  async archive(id: string) {
    const [immeuble] = await mettreAJourAvecAudit(
      this.db,
      immeubles,
      id,
      { statut: "archive", archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!immeuble) {
      throw new NotFoundException("Immeuble introuvable");
    }
    return immeuble;
  }
}
