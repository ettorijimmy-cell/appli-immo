import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { garants, type Database } from "db";
import { eq } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateGarantDto } from "./dto/create-garant.dto";
import type { UpdateGarantDto } from "./dto/update-garant.dto";

@Injectable()
export class GarantsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async create(dto: CreateGarantDto) {
    const [garant] = await this.db
      .insert(garants)
      .values({
        bailId: dto.bailId,
        nom: dto.nom,
        prenom: dto.prenom,
        email: dto.email,
        telephone: dto.telephone,
        typeGarantie: dto.typeGarantie
      })
      .returning();
    if (!garant) {
      throw new Error("Échec de la création du garant");
    }
    return garant;
  }

  async findAll(bailId?: string) {
    if (bailId) {
      return this.db.select().from(garants).where(eq(garants.bailId, bailId));
    }
    return this.db.select().from(garants);
  }

  async findById(id: string) {
    const [garant] = await this.db.select().from(garants).where(eq(garants.id, id)).limit(1);
    return garant ?? null;
  }

  async update(id: string, dto: UpdateGarantDto) {
    const [garant] = await this.db
      .update(garants)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(garants.id, id))
      .returning();
    if (!garant) {
      throw new NotFoundException("Garant introuvable");
    }
    return garant;
  }

  async archive(id: string) {
    const [garant] = await this.db
      .update(garants)
      .set({ archivedAt: new Date() })
      .where(eq(garants.id, id))
      .returning();
    if (!garant) {
      throw new NotFoundException("Garant introuvable");
    }
    return garant;
  }
}
