import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { immeublesLegacy, organisationSci, type Database } from "db";
import { and, eq, inArray } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";

type ImmeubleRow = typeof immeublesLegacy.$inferSelect;

// Lecture seule depuis le 2026-08-27 (décision utilisateur, docs/backlog.md,
// audit du sort de la table immeubles) : create()/update()/archive()
// retirés, la table a été renommée immeubles_legacy et ne doit plus
// recevoir aucune écriture applicative. findAll()/findById() restent
// nécessaires à documents.service.ts (verifierEntiteExiste, cas
// entiteType === 'immeuble') pour que les documents historiques déjà
// rattachés à une ligne de cette table restent consultables.
@Injectable()
export class ImmeublesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  // immeubles_legacy n'a qu'une FK directe vers scis, pas d'organisationId
  // (voir packages/db/src/schema/immeubles.ts) : même chemin de scoping que
  // ScisService.findAll() (via organisation_sci), une étape plus loin.
  async findAll(sciId?: string) {
    const organisationId = this.requestContext.getOrganisationId();
    const conditions = [...(sciId ? [eq(immeublesLegacy.sciId, sciId)] : [])];
    if (organisationId) {
      const rattachements = await this.db
        .select({ sciId: organisationSci.sciId })
        .from(organisationSci)
        .where(eq(organisationSci.organisationId, organisationId));
      const sciIds = rattachements.map((rattachement) => rattachement.sciId);
      if (sciIds.length === 0) {
        return [];
      }
      conditions.push(inArray(immeublesLegacy.sciId, sciIds));
    }
    const lignes =
      conditions.length > 0
        ? await this.db.select().from(immeublesLegacy).where(and(...conditions))
        : await this.db.select().from(immeublesLegacy);
    return lignes.map((immeuble) => this.versDto(immeuble));
  }

  // Contrôle d'appartenance (Sous-commit 5b, chantier scoping
  // multi-organisation, 2026-09-18) : immeubles_legacy n'a qu'une FK vers
  // scis, deux sauts jusqu'à organisation_sci (même chemin que
  // findAll() ci-dessus). Le gel en écriture de cette table (2026-08-27)
  // ne porte que sur create()/update()/archive() — jamais sur la lecture
  // ni sur son scoping, qui reste nécessaire (DocumentsService continue
  // de résoudre les documents historiques rattachés à ces lignes). Même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  async findById(id: string) {
    const [immeuble] = await this.db.select().from(immeublesLegacy).where(eq(immeublesLegacy.id, id)).limit(1);
    if (!immeuble) {
      throw new NotFoundException("Immeuble introuvable");
    }
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const [rattachement] = await this.db
        .select({ sciId: organisationSci.sciId })
        .from(organisationSci)
        .where(and(eq(organisationSci.sciId, immeuble.sciId), eq(organisationSci.organisationId, organisationId)))
        .limit(1);
      if (!rattachement) {
        throw new NotFoundException("Immeuble introuvable");
      }
    }
    return this.versDto(immeuble);
  }

  private versDto(immeuble: ImmeubleRow) {
    return {
      id: immeuble.id,
      createdAt: immeuble.createdAt,
      updatedAt: immeuble.updatedAt,
      updatedBy: immeuble.updatedBy,
      version: immeuble.version,
      archivedAt: immeuble.archivedAt,
      sciId: immeuble.sciId,
      nom: immeuble.nom,
      adresse: immeuble.adresse,
      codePostal: immeuble.codePostal,
      ville: immeuble.ville,
      typeHabitat: immeuble.typeHabitat,
      regimeJuridique: immeuble.regimeJuridique,
      anneeConstruction: immeuble.anneeConstruction,
      statut: immeuble.statut
    };
  }
}
