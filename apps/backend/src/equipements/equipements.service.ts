import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { equipements, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateEquipementDto } from "./dto/create-equipement.dto";
import type { UpdateEquipementDto } from "./dto/update-equipement.dto";

@Injectable()
export class EquipementsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateEquipementDto) {
    const [equipement] = await this.db
      .insert(equipements)
      .values({
        appartementId: dto.appartementId,
        type: dto.type,
        dateDernierEntretien: dto.dateDernierEntretien,
        intervalleEntretienMois: dto.intervalleEntretienMois
      })
      .returning();
    if (!equipement) {
      throw new Error("Échec de la création de l'équipement");
    }
    return equipement;
  }

  async findAll(appartementId?: string) {
    if (appartementId) {
      return this.db.select().from(equipements).where(eq(equipements.appartementId, appartementId));
    }
    return this.db.select().from(equipements);
  }

  async findById(id: string) {
    const [equipement] = await this.db
      .select()
      .from(equipements)
      .where(eq(equipements.id, id))
      .limit(1);
    return equipement ?? null;
  }

  async update(id: string, dto: UpdateEquipementDto) {
    const [equipement] = await mettreAJourAvecAudit(
      this.db,
      equipements,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!equipement) {
      throw new NotFoundException("Équipement introuvable");
    }
    return equipement;
  }

  // Pas de colonne `statut` dédiée (voir docs/data-dictionary.md) :
  // archivedAt seul suffit, pas de cycle de vie à états multiples ici.
  async archive(id: string) {
    const [equipement] = await mettreAJourAvecAudit(
      this.db,
      equipements,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!equipement) {
      throw new NotFoundException("Équipement introuvable");
    }
    return equipement;
  }
}
