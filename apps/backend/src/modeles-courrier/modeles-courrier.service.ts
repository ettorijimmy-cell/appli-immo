import { Inject, Injectable } from "@nestjs/common";
import { mettreAJourAvecAudit, modeleCourrier, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";

type ModeleCourrierRow = typeof modeleCourrier.$inferSelect;

export interface UpsertModeleCourrierParams {
  code: string;
  nom: string;
  canal: "email";
  objet: string | null;
  corps: string;
  variablesRequises: string[];
  organisationId: string;
}

// Pas de create()/update() HTTP exposés dans cette étape (Module Tâches,
// Étape 2, docs/backlog.md) : aucun écran d'édition prévu, décision
// explicite. findByCode/upsertModeleCourrier servent uniquement les
// consommateurs applicatifs (scripts de seed, futurs services générateurs
// — quittance à l'Étape 4, Messagerie plus tard).
@Injectable()
export class ModelesCourrierService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async findByCode(code: string) {
    const [ligne] = await this.db.select().from(modeleCourrier).where(eq(modeleCourrier.code, code)).limit(1);
    return ligne ? this.versDto(ligne) : null;
  }

  // Idempotent par `code` — réutilisable tel quel par tout script de seed
  // futur (même mécanique que BienService/AppartementsService pour
  // seed-test-bien-appartement.ts).
  async upsertModeleCourrier(params: UpsertModeleCourrierParams) {
    const [existant] = await this.db
      .select({ id: modeleCourrier.id })
      .from(modeleCourrier)
      .where(eq(modeleCourrier.code, params.code))
      .limit(1);

    if (existant) {
      const [misAJour] = await mettreAJourAvecAudit(
        this.db,
        modeleCourrier,
        existant.id,
        {
          nom: params.nom,
          canal: params.canal,
          objet: params.objet,
          corps: params.corps,
          variablesRequises: params.variablesRequises,
          organisationId: params.organisationId
        },
        this.requestContext.getUtilisateurId()
      );
      if (!misAJour) {
        throw new Error(`Échec de la mise à jour du modèle de courrier "${params.code}"`);
      }
      return this.versDto(misAJour as ModeleCourrierRow);
    }

    const [cree] = await this.db
      .insert(modeleCourrier)
      .values({
        code: params.code,
        nom: params.nom,
        canal: params.canal,
        objet: params.objet,
        corps: params.corps,
        variablesRequises: params.variablesRequises,
        organisationId: params.organisationId
      })
      .returning();
    if (!cree) {
      throw new Error(`Échec de la création du modèle de courrier "${params.code}"`);
    }
    return this.versDto(cree);
  }

  private versDto(ligne: ModeleCourrierRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      code: ligne.code,
      nom: ligne.nom,
      canal: ligne.canal,
      objet: ligne.objet,
      corps: ligne.corps,
      variablesRequises: ligne.variablesRequises,
      organisationId: ligne.organisationId
    };
  }
}
