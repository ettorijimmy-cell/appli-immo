import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { creerRattachementProprietaire } from "core";
import { mettreAJourAvecAudit, organisationSci, scis, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateSciDto } from "./dto/create-sci.dto";

@Injectable()
export class ScisService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly requestContext: RequestContextService
  ) {}

  async create(userId: string, dto: CreateSciDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    return this.db.transaction(async (tx) => {
      const [sci] = await tx
        .insert(scis)
        .values({
          nom: dto.nom,
          regimeFiscal: dto.regimeFiscal,
          formeJuridique: dto.formeJuridique,
          siret: dto.siret
        })
        .returning();
      if (!sci) {
        throw new Error("Échec de la création de la SCI");
      }

      const rattachement = creerRattachementProprietaire({
        organisationId: user.organisationId,
        sciId: sci.id,
        dateDebut: new Date().toISOString().slice(0, 10)
      });

      await tx.insert(organisationSci).values(rattachement);

      return sci;
    });
  }

  async findAll() {
    return this.db.select().from(scis);
  }

  async findById(id: string) {
    const [sci] = await this.db.select().from(scis).where(eq(scis.id, id)).limit(1);
    return sci ?? null;
  }

  async archive(id: string) {
    const [sci] = await mettreAJourAvecAudit(
      this.db,
      scis,
      id,
      { statut: "archive", archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!sci) {
      throw new NotFoundException("SCI introuvable");
    }
    return sci;
  }
}
