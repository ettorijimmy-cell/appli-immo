import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { locataires, type Database } from "db";
import { eq } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateLocataireDto } from "./dto/create-locataire.dto";
import type { UpdateLocataireDto } from "./dto/update-locataire.dto";

@Injectable()
export class LocatairesService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async create(dto: CreateLocataireDto) {
    const [locataire] = await this.db
      .insert(locataires)
      .values({
        nom: dto.nom,
        prenom: dto.prenom,
        email: dto.email,
        telephone: dto.telephone
      })
      .returning();
    if (!locataire) {
      throw new Error("Échec de la création du locataire");
    }
    return locataire;
  }

  async findAll() {
    return this.db.select().from(locataires);
  }

  async findById(id: string) {
    const [locataire] = await this.db.select().from(locataires).where(eq(locataires.id, id)).limit(1);
    return locataire ?? null;
  }

  async update(id: string, dto: UpdateLocataireDto) {
    const [locataire] = await this.db
      .update(locataires)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(locataires.id, id))
      .returning();
    if (!locataire) {
      throw new NotFoundException("Locataire introuvable");
    }
    return locataire;
  }

  async archive(id: string) {
    const [locataire] = await this.db
      .update(locataires)
      .set({ statut: "archive", archivedAt: new Date() })
      .where(eq(locataires.id, id))
      .returning();
    if (!locataire) {
      throw new NotFoundException("Locataire introuvable");
    }
    return locataire;
  }
}
