import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { bailLocataires, mettreAJourAvecAudit, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateBailLocataireDto } from "./dto/create-bail-locataire.dto";

type BailLocataireRow = typeof bailLocataires.$inferSelect;

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
    return this.versDto(lien);
  }

  async findAll(bailId?: string, locataireId?: string) {
    const conditions = [
      ...(bailId ? [eq(bailLocataires.bailId, bailId)] : []),
      ...(locataireId ? [eq(bailLocataires.locataireId, locataireId)] : [])
    ];
    const lignes =
      conditions.length === 0
        ? await this.db.select().from(bailLocataires)
        : await this.db
            .select()
            .from(bailLocataires)
            .where(conditions.length === 1 ? conditions[0] : and(...conditions));
    return lignes.map((lien) => this.versDto(lien));
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
    return this.versDto(lien as BailLocataireRow);
  }

  private versDto(lien: BailLocataireRow) {
    return {
      id: lien.id,
      createdAt: lien.createdAt,
      updatedAt: lien.updatedAt,
      updatedBy: lien.updatedBy,
      version: lien.version,
      archivedAt: lien.archivedAt,
      bailId: lien.bailId,
      locataireId: lien.locataireId,
      role: lien.role
    };
  }
}
