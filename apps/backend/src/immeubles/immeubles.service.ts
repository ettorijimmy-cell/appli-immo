import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { immeubles, type Database } from "db";
import { eq } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateImmeubleDto } from "./dto/create-immeuble.dto";
import type { UpdateImmeubleDto } from "./dto/update-immeuble.dto";

@Injectable()
export class ImmeublesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

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
    const [immeuble] = await this.db
      .update(immeubles)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(immeubles.id, id))
      .returning();
    if (!immeuble) {
      throw new NotFoundException("Immeuble introuvable");
    }
    return immeuble;
  }

  async archive(id: string) {
    const [immeuble] = await this.db
      .update(immeubles)
      .set({ statut: "archive", archivedAt: new Date() })
      .where(eq(immeubles.id, id))
      .returning();
    if (!immeuble) {
      throw new NotFoundException("Immeuble introuvable");
    }
    return immeuble;
  }
}
