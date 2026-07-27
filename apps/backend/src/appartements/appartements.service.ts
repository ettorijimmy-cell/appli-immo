import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { appartements, type Database } from "db";
import { eq } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateAppartementDto } from "./dto/create-appartement.dto";
import type { UpdateAppartementDto } from "./dto/update-appartement.dto";

@Injectable()
export class AppartementsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async create(dto: CreateAppartementDto) {
    const [appartement] = await this.db
      .insert(appartements)
      .values({
        immeubleId: dto.immeubleId,
        numero: dto.numero,
        type: dto.type,
        surface: dto.surface,
        loyerReference: dto.loyerReference
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
    const [appartement] = await this.db
      .update(appartements)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(appartements.id, id))
      .returning();
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }
    return appartement;
  }

  async archive(id: string) {
    const [appartement] = await this.db
      .update(appartements)
      .set({ statut: "archive", archivedAt: new Date() })
      .where(eq(appartements.id, id))
      .returning();
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }
    return appartement;
  }
}
