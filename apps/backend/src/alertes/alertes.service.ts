import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { alertes, mettreAJourAvecAudit, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { OrganisationResolutionService } from "../organisation-resolution/organisation-resolution.service";
import type { AlerteType } from "./alertes-config.service";

export interface FindAllAlertesFiltres {
  statut?: "active" | "traitee" | "ignoree" | "resolue";
  type?: AlerteType;
}

type AlerteRow = typeof alertes.$inferSelect;

// Scoping multi-organisation (audit 2026-10-03, docs/backlog.md — `alertes`
// avait été explicitement exclue du chantier de scoping d'origine,
// 2026-09-18/22, faute de colonne/FK directe vers une organisation).
// `entiteId` est polymorphe selon `type` (packages/db/src/schema/alertes.ts)
// — résolution déléguée à OrganisationResolutionService (partagée avec
// DocumentsService), jamais un chemin de jointure dupliqué ici.
@Injectable()
export class AlertesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly organisationResolution: OrganisationResolutionService
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

    // Skip si organisationId absent (hors contexte HTTP — jobs planifiés,
    // scripts, tests appelant le service directement) : même tolérance que
    // le reste du chantier de scoping (DocumentsService, TachesService...).
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return lignes.map((alerte) => this.versDto(alerte));
    }

    const visibles = await this.filtrerParOrganisation(lignes, organisationId);
    return visibles.map((alerte) => this.versDto(alerte));
  }

  async traiter(id: string) {
    return this.changerStatut(id, "traitee");
  }

  async ignorer(id: string) {
    return this.changerStatut(id, "ignoree");
  }

  // Contrôle d'appartenance AVANT toute écriture (même principe que
  // Catégorie C du chantier de scoping — DocumentsService.update/archiver,
  // TachesService.appliquerRevision/envoyerNotification) : jamais de
  // 403, le même message "introuvable" qu'un id qui n'existe pas du tout,
  // aucune différence observable entre les deux cas.
  private async changerStatut(id: string, statut: "traitee" | "ignoree") {
    const [alerte] = await this.db.select().from(alertes).where(eq(alertes.id, id)).limit(1);
    if (!alerte) {
      throw new NotFoundException("Alerte introuvable");
    }

    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const appartient = await this.appartientOrganisation(alerte, organisationId);
      if (!appartient) {
        throw new NotFoundException("Alerte introuvable");
      }
    }

    const [misAJour] = await mettreAJourAvecAudit(
      this.db,
      alertes,
      id,
      { statut },
      this.requestContext.getUtilisateurId()
    );
    if (!misAJour) {
      throw new NotFoundException("Alerte introuvable");
    }
    return this.versDto(misAJour as AlerteRow);
  }

  // Batch par type PRÉSENT parmi les lignes à filtrer (jamais les 5 types à
  // chaque appel) : une seule résolution d'ids valides par type, réutilisée
  // pour toutes les lignes de ce type — même principe que
  // DocumentsService.findAll (entiteType absent, branchesParType).
  private async filtrerParOrganisation(lignes: AlerteRow[], organisationId: string): Promise<AlerteRow[]> {
    const typesPresents = Array.from(new Set(lignes.map((ligne) => ligne.type)));
    const entrees = await Promise.all(
      typesPresents.map(async (type) => [type, await this.resoudreIdsValidesPourType(type, organisationId)] as const)
    );
    const idsValidesParType = new Map(entrees);
    return lignes.filter((ligne) => (idsValidesParType.get(ligne.type) ?? []).includes(ligne.entiteId));
  }

  private async appartientOrganisation(alerte: AlerteRow, organisationId: string): Promise<boolean> {
    const idsValides = await this.resoudreIdsValidesPourType(alerte.type, organisationId);
    return idsValides.includes(alerte.entiteId);
  }

  // Un cas par type d'alerte, jamais un chemin de jointure généralisé —
  // même discipline que OrganisationResolutionService.resoudreEntiteIdsOrganisation.
  // `bail_fin_proche`/`sinistre_stagnation` réutilisent exactement les cas
  // déjà couverts pour DocumentsService (`bail`/`sinistre`) ; `impaye`/
  // `entretien_equipement` ont leur propre chemin (paiements/equipements,
  // absents de DocumentEntiteType) ; `document_expire`/`document_expire_proche`
  // réutilisent la double résolution polymorphe (resoudreDocumentIdsOrganisation).
  private async resoudreIdsValidesPourType(type: AlerteType, organisationId: string): Promise<string[]> {
    switch (type) {
      case "bail_fin_proche":
        return this.organisationResolution.resoudreEntiteIdsOrganisation("bail", organisationId);
      case "sinistre_stagnation":
        return this.organisationResolution.resoudreEntiteIdsOrganisation("sinistre", organisationId);
      case "impaye":
        return this.organisationResolution.resoudrePaiementIdsOrganisation(organisationId);
      case "entretien_equipement":
        return this.organisationResolution.resoudreEquipementIdsOrganisation(organisationId);
      case "document_expire":
      case "document_expire_proche":
        return this.organisationResolution.resoudreDocumentIdsOrganisation(organisationId);
    }
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
