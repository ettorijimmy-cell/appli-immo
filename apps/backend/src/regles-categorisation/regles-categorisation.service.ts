import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { mettreAJourAvecAudit, regleCategorisation, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateRegleCategorisationDto } from "./dto/create-regle-categorisation.dto";

type RegleCategorisationRow = typeof regleCategorisation.$inferSelect;

@Injectable()
export class ReglesCategorisationService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService
  ) {}

  async create(userId: string, dto: CreateRegleCategorisationDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    const [regle] = await this.db
      .insert(regleCategorisation)
      .values({
        motCle: dto.motCle,
        categorie: dto.categorie,
        organisationId: user.organisationId
      })
      .returning();
    if (!regle) {
      throw new Error("Échec de la création de la règle de catégorisation");
    }
    return this.versDto(regle);
  }

  // Utilisé par l'écran de gestion des règles — même mécanisme de scoping
  // que DepensesService.findAll (toute requête HTTP réelle passe par le
  // JwtAuthGuard global, donc getOrganisationId() y est toujours
  // résolvable). Lu directement depuis le JWT décodé (Commit 2,
  // docs/data-dictionary.md), jamais un lookup UsersService.
  async findAll() {
    const conditions = [isNull(regleCategorisation.archivedAt)];
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      conditions.push(eq(regleCategorisation.organisationId, organisationId));
    }
    const lignes = await this.db
      .select()
      .from(regleCategorisation)
      .where(and(...conditions));
    return lignes.map((ligne) => this.versDto(ligne));
  }

  // Utilisé par DepensesService.parserCsv : organisationId déjà résolu par
  // l'appelant (depuis l'utilisateur authentifié de la requête d'import),
  // jamais dérivé à nouveau ici — pas de dépendance au contexte requête,
  // contrairement à findAll() ci-dessus.
  async findAllActives(organisationId: string) {
    const lignes = await this.db
      .select()
      .from(regleCategorisation)
      .where(and(isNull(regleCategorisation.archivedAt), eq(regleCategorisation.organisationId, organisationId)));
    return lignes.map((ligne) => this.versDto(ligne));
  }

  // Archivage, jamais de suppression physique (CLAUDE.md) — pas d'update()
  // à cette étape : modifier une règle revient à l'archiver et en créer
  // une nouvelle, plus simple pour un aussi petit volume de données.
  async archive(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19) : ce service n'a
    // jamais eu de findById() (aucun endpoint de lecture à l'unité), donc
    // pas de helper préexistant à réutiliser contrairement aux autres
    // services de cette priorité — extrait ici directement, même principe
    // que Catégorie A (colonne organisationId directe).
    await this.resoudreRegleAvecAppartenance(id);

    const [regle] = await mettreAJourAvecAudit(
      this.db,
      regleCategorisation,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!regle) {
      throw new NotFoundException("Règle de catégorisation introuvable");
    }
    return this.versDto(regle as RegleCategorisationRow);
  }

  private async resoudreRegleAvecAppartenance(id: string): Promise<RegleCategorisationRow> {
    const [ligne] = await this.db.select().from(regleCategorisation).where(eq(regleCategorisation.id, id)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!ligne || (organisationId && ligne.organisationId !== organisationId)) {
      throw new NotFoundException("Règle de catégorisation introuvable");
    }
    return ligne;
  }

  private versDto(ligne: RegleCategorisationRow) {
    return {
      id: ligne.id,
      motCle: ligne.motCle,
      categorie: ligne.categorie,
      organisationId: ligne.organisationId,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt
    };
  }
}
