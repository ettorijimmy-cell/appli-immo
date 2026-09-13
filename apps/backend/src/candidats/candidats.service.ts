import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { candidat, mettreAJourAvecAudit, type Database } from "db";
import { eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateCandidatDto } from "./dto/create-candidat.dto";
import type { UpdateCandidatDto } from "./dto/update-candidat.dto";

type CandidatRow = typeof candidat.$inferSelect;

@Injectable()
export class CandidatsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService
  ) {}

  async create(userId: string, dto: CreateCandidatDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    const [ligne] = await this.db
      .insert(candidat)
      .values({
        nom: dto.nom,
        telephone: dto.telephone,
        email: dto.email,
        appartementId: dto.appartementId,
        notes: dto.notes,
        statut: dto.statut,
        revenuMensuelNet: dto.revenuMensuelNet,
        loyerVise: dto.loyerVise,
        situationProfessionnelle: dto.situationProfessionnelle,
        garantNom: dto.garantNom,
        garantRevenuMensuelNet: dto.garantRevenuMensuelNet,
        organisationId: user.organisationId
      })
      .returning();
    if (!ligne) {
      throw new Error("Échec de la création du candidat");
    }
    return this.versDto(ligne);
  }

  // Même pattern de scoping que ContactsService/LocatairesService — no-op
  // en dehors d'un contexte HTTP (scripts/tests directs).
  async findAll() {
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      const utilisateur = await this.usersService.findById(utilisateurId);
      if (utilisateur) {
        const lignes = await this.db.select().from(candidat).where(eq(candidat.organisationId, utilisateur.organisationId));
        return lignes.map((ligne) => this.versDto(ligne));
      }
    }
    const lignes = await this.db.select().from(candidat);
    return lignes.map((ligne) => this.versDto(ligne));
  }

  async findById(id: string) {
    const [ligne] = await this.db.select().from(candidat).where(eq(candidat.id, id)).limit(1);
    return ligne ? this.versDto(ligne) : null;
  }

  async update(id: string, dto: UpdateCandidatDto) {
    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      candidat,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Candidat introuvable");
    }
    return this.versDto(ligne as CandidatRow);
  }

  async archive(id: string) {
    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      candidat,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Candidat introuvable");
    }
    return this.versDto(ligne as CandidatRow);
  }

  private versDto(ligne: CandidatRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      nom: ligne.nom,
      telephone: ligne.telephone,
      email: ligne.email,
      appartementId: ligne.appartementId,
      notes: ligne.notes,
      statut: ligne.statut,
      revenuMensuelNet: ligne.revenuMensuelNet,
      loyerVise: ligne.loyerVise,
      situationProfessionnelle: ligne.situationProfessionnelle,
      garantNom: ligne.garantNom,
      garantRevenuMensuelNet: ligne.garantRevenuMensuelNet,
      organisationId: ligne.organisationId
    };
  }
}
