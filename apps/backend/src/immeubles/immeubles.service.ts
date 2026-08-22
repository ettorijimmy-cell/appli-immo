import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { immeubles, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateImmeubleDto } from "./dto/create-immeuble.dto";
import type { UpdateImmeubleDto } from "./dto/update-immeuble.dto";

type ImmeubleRow = typeof immeubles.$inferSelect;

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
        ville: dto.ville,
        typeHabitat: dto.typeHabitat,
        regimeJuridique: dto.regimeJuridique
      })
      .returning();
    if (!immeuble) {
      throw new Error("Échec de la création de l'immeuble");
    }
    return this.versDto(immeuble);
  }

  async findAll(sciId?: string) {
    const lignes = sciId
      ? await this.db.select().from(immeubles).where(eq(immeubles.sciId, sciId))
      : await this.db.select().from(immeubles);
    return lignes.map((immeuble) => this.versDto(immeuble));
  }

  async findById(id: string) {
    const [immeuble] = await this.db.select().from(immeubles).where(eq(immeubles.id, id)).limit(1);
    return immeuble ? this.versDto(immeuble) : null;
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
    return this.versDto(immeuble as ImmeubleRow);
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
    return this.versDto(immeuble as ImmeubleRow);
  }

  private versDto(immeuble: ImmeubleRow) {
    return {
      id: immeuble.id,
      createdAt: immeuble.createdAt,
      updatedAt: immeuble.updatedAt,
      updatedBy: immeuble.updatedBy,
      version: immeuble.version,
      archivedAt: immeuble.archivedAt,
      sciId: immeuble.sciId,
      nom: immeuble.nom,
      adresse: immeuble.adresse,
      codePostal: immeuble.codePostal,
      ville: immeuble.ville,
      typeHabitat: immeuble.typeHabitat,
      regimeJuridique: immeuble.regimeJuridique,
      anneeConstruction: immeuble.anneeConstruction,
      statut: immeuble.statut
    };
  }
}
