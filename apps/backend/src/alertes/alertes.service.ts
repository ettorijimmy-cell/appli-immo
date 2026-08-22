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

type AlerteRow = typeof alertes.$inferSelect;

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
    const lignes = await this.db
      .select()
      .from(alertes)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return lignes.map((alerte) => this.versDto(alerte));
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
    return this.versDto(alerte as AlerteRow);
  }

  // derniere_condition_vraie est un champ interne au job de génération
  // d'alertes (voir packages/db/src/schema/alertes.ts) — jamais exposé à
  // l'utilisateur, même principe que documents.chemin_stockage
  // (DocumentsService.versDto).
  private versDto(alerte: AlerteRow) {
    return {
      id: alerte.id,
      createdAt: alerte.createdAt,
      updatedAt: alerte.updatedAt,
      updatedBy: alerte.updatedBy,
      version: alerte.version,
      archivedAt: alerte.archivedAt,
      type: alerte.type,
      entiteId: alerte.entiteId,
      statut: alerte.statut,
      message: alerte.message,
      dateReference: alerte.dateReference
    };
  }
}
