import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { alertes, mettreAJourAvecAudit, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { AlerteType } from "./alertes-config.service";

export interface FindAllAlertesFiltres {
  statut?: "active" | "traitee" | "ignoree" | "resolue";
  type?: AlerteType;
}

@Injectable()
export class AlertesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async findAll(filtres: FindAllAlertesFiltres) {
    const conditions = [];
    if (filtres.statut) {
      conditions.push(eq(alertes.statut, filtres.statut));
    }
    if (filtres.type) {
      conditions.push(eq(alertes.type, filtres.type));
    }
    return this.db
      .select()
      .from(alertes)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
  }

  async traiter(id: string) {
    return this.changerStatut(id, "traitee");
  }

  async ignorer(id: string) {
    return this.changerStatut(id, "ignoree");
  }

  private async changerStatut(id: string, statut: "traitee" | "ignoree") {
    const [alerte] = await mettreAJourAvecAudit(
      this.db,
      alertes,
      id,
      { statut },
      this.requestContext.getUtilisateurId()
    );
    if (!alerte) {
      throw new NotFoundException("Alerte introuvable");
    }
    return alerte;
  }
}
