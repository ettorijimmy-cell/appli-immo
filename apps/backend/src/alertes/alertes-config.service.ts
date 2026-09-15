import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { alerteTypeEnum, mettreAJourAvecAudit, parametresAlertes, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";

export type AlerteType = (typeof alerteTypeEnum.enumValues)[number];

// document_expire n'a volontairement pas d'entrée : c'est un statut déjà
// calculé (calculerStatutDocument), pas une fenêtre d'anticipation — rien à
// configurer (docs/data-dictionary.md, section alertes).
const SEUILS_PAR_DEFAUT: Partial<Record<AlerteType, number>> = {
  bail_fin_proche: 30,
  document_expire_proche: 30,
  entretien_equipement: 30,
  impaye: 5,
  // Module Suivi sinistre et assurance (2026-09-16) : délai fixe et
  // identique quel que soit le statut du sinistre — décision actée avec
  // Jimmy.
  sinistre_stagnation: 15
};

export const TYPES_AVEC_SEUIL_CONFIGURABLE = Object.keys(SEUILS_PAR_DEFAUT) as AlerteType[];

type ParametreAlerteRow = typeof parametresAlertes.$inferSelect;

@Injectable()
export class AlertesConfigService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  // Renvoie les 4 types configurables, créant en base (valeur par défaut)
  // ceux qui n'existent pas encore — jamais de migration de données écrite
  // à la main pour les peupler (CLAUDE.md).
  async findAll() {
    const existants = await this.db.select().from(parametresAlertes);
    const parType = new Map(existants.map((ligne) => [ligne.type, ligne]));
    const resultats = [];
    for (const type of TYPES_AVEC_SEUIL_CONFIGURABLE) {
      const existant = parType.get(type);
      if (existant) {
        resultats.push(this.versDto(existant));
        continue;
      }
      resultats.push(this.versDto(await this.creerAvecDefaut(type)));
    }
    return resultats;
  }

  async getSeuil(type: AlerteType): Promise<number> {
    const [existant] = await this.db
      .select()
      .from(parametresAlertes)
      .where(eq(parametresAlertes.type, type))
      .limit(1);
    if (existant) {
      return existant.seuilJoursAvant;
    }
    return (await this.creerAvecDefaut(type)).seuilJoursAvant;
  }

  async update(type: AlerteType, seuilJoursAvant: number) {
    if (!TYPES_AVEC_SEUIL_CONFIGURABLE.includes(type)) {
      throw new ConflictException(`Le type '${type}' n'a pas de seuil configurable.`);
    }
    const [existant] = await this.db
      .select()
      .from(parametresAlertes)
      .where(eq(parametresAlertes.type, type))
      .limit(1);
    if (!existant) {
      const [cree] = await this.db.insert(parametresAlertes).values({ type, seuilJoursAvant }).returning();
      if (!cree) {
        throw new Error("Échec de la création du paramètre d'alerte");
      }
      return this.versDto(cree);
    }
    const [maj] = await mettreAJourAvecAudit(
      this.db,
      parametresAlertes,
      existant.id,
      { seuilJoursAvant },
      this.requestContext.getUtilisateurId()
    );
    if (!maj) {
      throw new Error("Échec de la mise à jour du paramètre d'alerte");
    }
    return this.versDto(maj as ParametreAlerteRow);
  }

  private async creerAvecDefaut(type: AlerteType) {
    const seuilParDefaut = SEUILS_PAR_DEFAUT[type];
    if (seuilParDefaut === undefined) {
      throw new ConflictException(`Le type '${type}' n'a pas de seuil configurable.`);
    }
    const [cree] = await this.db
      .insert(parametresAlertes)
      .values({ type, seuilJoursAvant: seuilParDefaut })
      .onConflictDoNothing()
      .returning();
    if (cree) {
      return cree;
    }
    // Conflit : une autre requête concurrente vient de le créer, on relit.
    const [existant] = await this.db
      .select()
      .from(parametresAlertes)
      .where(eq(parametresAlertes.type, type))
      .limit(1);
    if (!existant) {
      throw new Error(`Échec de la création du paramètre d'alerte par défaut pour '${type}'`);
    }
    return existant;
  }

  private versDto(parametre: ParametreAlerteRow) {
    return {
      id: parametre.id,
      createdAt: parametre.createdAt,
      updatedAt: parametre.updatedAt,
      updatedBy: parametre.updatedBy,
      version: parametre.version,
      archivedAt: parametre.archivedAt,
      type: parametre.type,
      seuilJoursAvant: parametre.seuilJoursAvant
    };
  }
}
