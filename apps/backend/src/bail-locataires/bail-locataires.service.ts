import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { bailLocataires, mettreAJourAvecAudit, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateBailLocataireDto } from "./dto/create-bail-locataire.dto";

@Injectable()
export class BailLocatairesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateBailLocataireDto) {
    const [lien] = await this.db
      .insert(bailLocataires)
      .values({
        bailId: dto.bailId,
        locataireId: dto.locataireId,
        role: dto.role
      })
      .returning();
    if (!lien) {
      throw new Error("Échec du rattachement du locataire au bail");
    }
    return lien;
  }

  async findAll(bailId?: string, locataireId?: string) {
    const conditions = [
      ...(bailId ? [eq(bailLocataires.bailId, bailId)] : []),
      ...(locataireId ? [eq(bailLocataires.locataireId, locataireId)] : [])
    ];
    if (conditions.length === 0) {
      return this.db.select().from(bailLocataires);
    }
    return this.db
      .select()
      .from(bailLocataires)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions));
  }

  // Retire un locataire d'un bail — archive le lien, ne le supprime jamais
  // physiquement (CLAUDE.md).
  async archive(id: string) {
    const [lien] = await mettreAJourAvecAudit(
      this.db,
      bailLocataires,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!lien) {
      throw new NotFoundException("Rattachement introuvable");
    }
    return lien;
  }
}
