import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { appartements, bailLocataires, baux, bien, mettreAJourAvecAudit, type Database } from "db";
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

  // bail_locataires n'a pas de colonne organisationId directe : le scoping
  // passe par une triple jointure bail_locataires -> baux -> appartements
  // -> bien (bien.organisationId), un niveau plus loin que BauxService.
  async findAll(bailId?: string, locataireId?: string) {
    const conditionsBase = [
      ...(bailId ? [eq(bailLocataires.bailId, bailId)] : []),
      ...(locataireId ? [eq(bailLocataires.locataireId, locataireId)] : [])
    ];
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const rows = await this.db
        .select({ lien: bailLocataires })
        .from(bailLocataires)
        .innerJoin(baux, eq(baux.id, bailLocataires.bailId))
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(eq(bien.organisationId, organisationId), ...conditionsBase));
      return rows.map((row) => this.versDto(row.lien));
    }
    const lignes =
      conditionsBase.length === 0
        ? await this.db.select().from(bailLocataires)
        : await this.db
            .select()
            .from(bailLocataires)
            .where(conditionsBase.length === 1 ? conditionsBase[0] : and(...conditionsBase));
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
