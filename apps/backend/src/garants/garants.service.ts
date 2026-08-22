import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { garants, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateGarantDto } from "./dto/create-garant.dto";
import type { UpdateGarantDto } from "./dto/update-garant.dto";

type GarantRow = typeof garants.$inferSelect;

@Injectable()
export class GarantsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateGarantDto) {
    const [garant] = await this.db
      .insert(garants)
      .values({
        bailId: dto.bailId,
        nom: dto.nom,
        prenom: dto.prenom,
        email: dto.email,
        telephone: dto.telephone,
        typeGarantie: dto.typeGarantie,
        dateNaissance: dto.dateNaissance,
        lieuNaissance: dto.lieuNaissance,
        nationalite: dto.nationalite
      })
      .returning();
    if (!garant) {
      throw new Error("Échec de la création du garant");
    }
    return this.versDto(garant);
  }

  async findAll(bailId?: string) {
    const lignes = bailId
      ? await this.db.select().from(garants).where(eq(garants.bailId, bailId))
      : await this.db.select().from(garants);
    return lignes.map((garant) => this.versDto(garant));
  }

  async findById(id: string) {
    const [garant] = await this.db.select().from(garants).where(eq(garants.id, id)).limit(1);
    return garant ? this.versDto(garant) : null;
  }

  async update(id: string, dto: UpdateGarantDto) {
    const [garant] = await mettreAJourAvecAudit(
      this.db,
      garants,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!garant) {
      throw new NotFoundException("Garant introuvable");
    }
    return this.versDto(garant as GarantRow);
  }

  async archive(id: string) {
    const [garant] = await mettreAJourAvecAudit(
      this.db,
      garants,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!garant) {
      throw new NotFoundException("Garant introuvable");
    }
    return this.versDto(garant as GarantRow);
  }

  // profession/revenus (données financières précises,
  // packages/db/src/schema/garants.ts) ne sont exposés ni ici ni par le
  // Sync Stream garants. Absents même de l'interface Garant du frontend
  // desktop — aucun code n'en dépend en lecture.
  private versDto(garant: GarantRow) {
    return {
      id: garant.id,
      createdAt: garant.createdAt,
      updatedAt: garant.updatedAt,
      updatedBy: garant.updatedBy,
      version: garant.version,
      archivedAt: garant.archivedAt,
      bailId: garant.bailId,
      nom: garant.nom,
      prenom: garant.prenom,
      email: garant.email,
      telephone: garant.telephone,
      typeGarantie: garant.typeGarantie,
      adresse: garant.adresse,
      codePostal: garant.codePostal,
      ville: garant.ville,
      dateNaissance: garant.dateNaissance,
      lieuNaissance: garant.lieuNaissance,
      nationalite: garant.nationalite
    };
  }
}
