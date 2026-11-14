import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { appartements, bailLocataires, baux, bien, mettreAJourAvecAudit, type Database } from "db";
import { and, eq, isNull, ne } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { ArchiverBailLocataireDto } from "./dto/archiver-bail-locataire.dto";
import type { CreateBailLocataireDto } from "./dto/create-bail-locataire.dto";
import type { UpdateBailLocataireDto } from "./dto/update-bail-locataire.dto";

type BailLocataireRow = typeof bailLocataires.$inferSelect;

@Injectable()
export class BailLocatairesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateBailLocataireDto) {
    const [lien] = await this.db
      .insert(bailLocataires)
      .values({
        bailId: dto.bailId,
        locataireId: dto.locataireId,
        role: dto.role
      })
      .returning();
    if (!lien) {
      throw new Error("Échec du rattachement du locataire au bail");
    }
    return this.versDto(lien);
  }

  // bail_locataires n'a pas de colonne organisationId directe : le scoping
  // passe par une triple jointure bail_locataires -> baux -> appartements
  // -> bien (bien.organisationId), un niveau plus loin que BauxService.
  async findAll(bailId?: string, locataireId?: string) {
    const conditionsBase = [
      ...(bailId ? [eq(bailLocataires.bailId, bailId)] : []),
      ...(locataireId ? [eq(bailLocataires.locataireId, locataireId)] : [])
    ];
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const rows = await this.db
        .select({ lien: bailLocataires })
        .from(bailLocataires)
        .innerJoin(baux, eq(baux.id, bailLocataires.bailId))
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(eq(bien.organisationId, organisationId), ...conditionsBase));
      return rows.map((row) => this.versDto(row.lien));
    }
    const lignes =
      conditionsBase.length === 0
        ? await this.db.select().from(bailLocataires)
        : await this.db
            .select()
            .from(bailLocataires)
            .where(conditionsBase.length === 1 ? conditionsBase[0] : and(...conditionsBase));
    return lignes.map((lien) => this.versDto(lien));
  }

  // Date d'effet du congé (chantier garants, commit 6) : sert à la fin
  // d'engagement de la caution du colocataire (loi n° 89-462, art. 8-1, VI).
  // Modifiable aussi sur un lien déjà retiré : le congé précède souvent le
  // retrait du locataire dans l'appli.
  async update(id: string, dto: UpdateBailLocataireDto) {
    await this.resoudreLienAvecAppartenance(id);
    const [lien] = await mettreAJourAvecAudit(
      this.db,
      bailLocataires,
      id,
      { dateEffetConge: dto.dateEffetConge },
      this.requestContext.getUtilisateurId()
    );
    if (!lien) {
      throw new NotFoundException("Rattachement introuvable");
    }
    return this.versDto(lien as BailLocataireRow);
  }

  // Retire un locataire d'un bail — archive le lien, ne le supprime jamais
  // physiquement (CLAUDE.md).
  async archive(id: string, dto: ArchiverBailLocataireDto = {}) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3b, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19) : ce service n'a
    // jamais eu de findById() (aucun endpoint de lecture à l'unité), donc
    // pas de helper préexistant à réutiliser — extrait ici directement.
    const lienARetirer = await this.resoudreLienAvecAppartenance(id);

    // Jamais un bail actif ou en préavis sans locataire (chantier
    // archivage, décision 4 du 2026-11-12) : refus si c'est le dernier lien
    // non retiré d'un tel bail. Après l'appartenance (404 d'abord). Un lien
    // déjà retiré, un colocataire parmi d'autres, ou un bail brouillon ou
    // résilié : rien n'est refusé.
    if (lienARetirer.archivedAt === null) {
      const [bail] = await this.db
        .select({ statut: baux.statut })
        .from(baux)
        .where(eq(baux.id, lienARetirer.bailId))
        .limit(1);
      if (bail && (bail.statut === "actif" || bail.statut === "preavis")) {
        const autresLiens = await this.db
          .select({ id: bailLocataires.id })
          .from(bailLocataires)
          .where(
            and(
              eq(bailLocataires.bailId, lienARetirer.bailId),
              isNull(bailLocataires.archivedAt),
              ne(bailLocataires.id, id)
            )
          )
          .limit(1);
        if (autresLiens.length === 0) {
          throw new ConflictException(
            "C'est le dernier locataire de ce bail actif ou en préavis. Résiliez le bail plutôt que de le retirer."
          );
        }
      }
    }

    const [lien] = await mettreAJourAvecAudit(
      this.db,
      bailLocataires,
      id,
      // Date d'effet du congé écrite avec le retrait, dans la même requête.
      { archivedAt: new Date(), ...(dto.dateEffetConge !== undefined ? { dateEffetConge: dto.dateEffetConge } : {}) },
      this.requestContext.getUtilisateurId()
    );
    if (!lien) {
      throw new NotFoundException("Rattachement introuvable");
    }
    return this.versDto(lien as BailLocataireRow);
  }

  // bail_locataires n'a pas de colonne organisationId directe (voir
  // findAll() plus haut, même triple jointure). Même message que "n'existe
  // pas", aucune différence observable. Skip si organisationId absent (hors
  // contexte HTTP).
  private async resoudreLienAvecAppartenance(id: string): Promise<BailLocataireRow> {
    const [lien] = await this.db.select().from(bailLocataires).where(eq(bailLocataires.id, id)).limit(1);
    if (!lien) {
      throw new NotFoundException("Rattachement introuvable");
    }
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const [ligne] = await this.db
        .select({ id: bailLocataires.id })
        .from(bailLocataires)
        .innerJoin(baux, eq(baux.id, bailLocataires.bailId))
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(eq(bailLocataires.id, id), eq(bien.organisationId, organisationId)))
        .limit(1);
      if (!ligne) {
        throw new NotFoundException("Rattachement introuvable");
      }
    }
    return lien;
  }

  private versDto(lien: BailLocataireRow) {
    return {
      id: lien.id,
      createdAt: lien.createdAt,
      updatedAt: lien.updatedAt,
      updatedBy: lien.updatedBy,
      version: lien.version,
      archivedAt: lien.archivedAt,
      bailId: lien.bailId,
      locataireId: lien.locataireId,
      role: lien.role,
      dateEffetConge: lien.dateEffetConge
    };
  }
}
