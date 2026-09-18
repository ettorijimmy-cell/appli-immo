import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { creerRattachementProprietaire } from "core";
import { mettreAJourAvecAudit, organisationSci, scis, type Database } from "db";
import { and, eq, inArray } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateSciDto } from "./dto/create-sci.dto";
import type { UpdateSciDto } from "./dto/update-sci.dto";

type SciRow = typeof scis.$inferSelect;

@Injectable()
export class ScisService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly requestContext: RequestContextService
  ) {}

  async create(userId: string, dto: CreateSciDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    return this.db.transaction(async (tx) => {
      const [sci] = await tx
        .insert(scis)
        .values({
          nom: dto.nom,
          regimeFiscal: dto.regimeFiscal,
          formeJuridique: dto.formeJuridique,
          siret: dto.siret,
          adresse: dto.adresse,
          codePostal: dto.codePostal,
          ville: dto.ville
        })
        .returning();
      if (!sci) {
        throw new Error("Échec de la création de la SCI");
      }

      const rattachement = creerRattachementProprietaire({
        organisationId: user.organisationId,
        sciId: sci.id,
        dateDebut: new Date().toISOString().slice(0, 10)
      });

      await tx.insert(organisationSci).values(rattachement);

      return this.versDto(sci);
    });
  }

  // scis n'a pas de colonne organisationId directe : le scoping passe par
  // organisation_sci (table de liaison, voir create() ci-dessus). role
  // ('proprietaire' ou 'mandataire') n'est volontairement pas filtré ici —
  // les deux donnent un accès légitime à la SCI.
  async findAll() {
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const rattachements = await this.db
        .select({ sciId: organisationSci.sciId })
        .from(organisationSci)
        .where(eq(organisationSci.organisationId, organisationId));
      const sciIds = rattachements.map((rattachement) => rattachement.sciId);
      if (sciIds.length === 0) {
        return [];
      }
      const lignes = await this.db.select().from(scis).where(inArray(scis.id, sciIds));
      return lignes.map((sci) => this.versDto(sci));
    }
    const lignes = await this.db.select().from(scis);
    return lignes.map((sci) => this.versDto(sci));
  }

  // Contrôle d'appartenance (Sous-commit 5b, chantier scoping
  // multi-organisation, 2026-09-18) : scis n'a pas de colonne
  // organisationId directe (voir findAll() ci-dessus), le contrôle passe
  // par une requête organisation_sci dédiée — même chemin que
  // ComptesBancairesSciService.verifierAppartenanceSci (commit B6). Même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  async findById(id: string) {
    const [sci] = await this.db.select().from(scis).where(eq(scis.id, id)).limit(1);
    if (!sci) {
      throw new NotFoundException("SCI introuvable");
    }
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const [rattachement] = await this.db
        .select({ sciId: organisationSci.sciId })
        .from(organisationSci)
        .where(and(eq(organisationSci.sciId, id), eq(organisationSci.organisationId, organisationId)))
        .limit(1);
      if (!rattachement) {
        throw new NotFoundException("SCI introuvable");
      }
    }
    return this.versDto(sci);
  }

  async update(id: string, dto: UpdateSciDto) {
    const [sci] = await mettreAJourAvecAudit(
      this.db,
      scis,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!sci) {
      throw new NotFoundException("SCI introuvable");
    }
    return this.versDto(sci as SciRow);
  }

  async archive(id: string) {
    const [sci] = await mettreAJourAvecAudit(
      this.db,
      scis,
      id,
      { statut: "archive", archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!sci) {
      throw new NotFoundException("SCI introuvable");
    }
    return this.versDto(sci as SciRow);
  }

  private versDto(sci: SciRow) {
    return {
      id: sci.id,
      createdAt: sci.createdAt,
      updatedAt: sci.updatedAt,
      updatedBy: sci.updatedBy,
      version: sci.version,
      archivedAt: sci.archivedAt,
      nom: sci.nom,
      regimeFiscal: sci.regimeFiscal,
      formeJuridique: sci.formeJuridique,
      siret: sci.siret,
      adresse: sci.adresse,
      codePostal: sci.codePostal,
      ville: sci.ville,
      nomGerant: sci.nomGerant,
      prenomGerant: sci.prenomGerant,
      telephone: sci.telephone,
      estFamiliale: sci.estFamiliale,
      statut: sci.statut
    };
  }
}
