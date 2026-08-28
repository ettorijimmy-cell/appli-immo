import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { mettreAJourAvecAudit, tache, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";

export interface FindAllTachesFiltres {
  statut?: "a_faire" | "en_cours" | "fait" | "annulee";
  type?: "impaye" | "entretien_equipement" | "document_expire" | "quittance_mensuelle" | "revision_loyer" | "autre";
  bailId?: string;
  appartementId?: string;
}

type TacheRow = typeof tache.$inferSelect;

@Injectable()
export class TachesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async findAll(filtres: FindAllTachesFiltres) {
    const conditions = [];
    if (filtres.statut) {
      conditions.push(eq(tache.statut, filtres.statut));
    }
    if (filtres.type) {
      conditions.push(eq(tache.type, filtres.type));
    }
    if (filtres.bailId) {
      conditions.push(eq(tache.bailId, filtres.bailId));
    }
    if (filtres.appartementId) {
      conditions.push(eq(tache.appartementId, filtres.appartementId));
    }
    const lignes = await this.db
      .select()
      .from(tache)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return lignes.map((ligne) => this.versDto(ligne));
  }

  async findById(id: string) {
    const [ligne] = await this.db.select().from(tache).where(eq(tache.id, id)).limit(1);
    return ligne ? this.versDto(ligne) : null;
  }

  // Action explicite plutôt qu'un update() générique sur `statut` : la
  // logique de dateCompletion (posée automatiquement) reste centralisée
  // ici, jamais répétée côté frontend.
  async marquerFait(id: string) {
    return this.changerStatut(id, "fait", new Date());
  }

  async marquerAnnulee(id: string) {
    return this.changerStatut(id, "annulee", null);
  }

  private async changerStatut(id: string, statut: "fait" | "annulee", dateCompletion: Date | null) {
    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      tache,
      id,
      { statut, dateCompletion },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Tâche introuvable");
    }
    return this.versDto(ligne as TacheRow);
  }

  private versDto(ligne: TacheRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      type: ligne.type,
      statut: ligne.statut,
      origine: ligne.origine,
      alerteSourceId: ligne.alerteSourceId,
      bailId: ligne.bailId,
      appartementId: ligne.appartementId,
      bienId: ligne.bienId,
      locataireId: ligne.locataireId,
      dateEcheance: ligne.dateEcheance,
      dateCompletion: ligne.dateCompletion,
      periodeRecurrence: ligne.periodeRecurrence,
      notes: ligne.notes,
      metadata: ligne.metadata,
      organisationId: ligne.organisationId
    };
  }
}
