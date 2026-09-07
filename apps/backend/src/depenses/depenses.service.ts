import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { parserReleveCsv, type LigneReleveCsvAvecId } from "core";
import { bien, depense, type Database } from "db";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateDepenseDto } from "./dto/create-depense.dto";

export interface FindAllDepensesFiltres {
  categorie?: CreateDepenseDto["categorie"];
  bienId?: string;
  sciId?: string;
  dateDebut?: string;
  dateFin?: string;
}

type DepenseRow = typeof depense.$inferSelect;

@Injectable()
export class DepensesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService
  ) {}

  async create(userId: string, dto: CreateDepenseDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    if (!dto.bienId && !dto.sciId) {
      throw new BadRequestException("bienId ou sciId est requis (au moins l'un des deux).");
    }

    // sciId dénormalisé depuis bien.sciId quand bienId est fourni — jamais
    // la valeur transmise par le client (bien.sciId est immuable après
    // création, voir UpdateBienDto, donc aucun risque d'incohérence future
    // à figer la valeur ici). Mirroring bien.organisationId (packages/db/
    // src/schema/bien.ts), même principe de dénormalisation.
    let sciId: string | null = dto.sciId ?? null;
    if (dto.bienId) {
      const [bienRattache] = await this.db.select().from(bien).where(eq(bien.id, dto.bienId)).limit(1);
      if (!bienRattache) {
        throw new NotFoundException("Bien introuvable");
      }
      sciId = bienRattache.sciId;
    }

    const [nouvelleDepense] = await this.db
      .insert(depense)
      .values({
        categorie: dto.categorie,
        montant: dto.montant,
        dateDepense: dto.dateDepense,
        libelle: dto.libelle,
        bienId: dto.bienId ?? null,
        sciId,
        organisationId: user.organisationId
      })
      .returning();
    if (!nouvelleDepense) {
      throw new Error("Échec de la création de la dépense");
    }
    return this.versDto(nouvelleDepense);
  }

  // Analyse pure, aucune écriture : renvoie les lignes brutes du relevé pour
  // sélection manuelle de catégorie + confirmation ligne par ligne côté
  // frontend (chaque confirmation appelle ensuite create() séparément) —
  // jamais de rapprochement automatique contre des dépenses existantes
  // (contrairement à PaiementsService.rapprocherCsv, sans équivalent ici :
  // la catégorisation par mots-clés est hors périmètre de cette étape,
  // voir docs/backlog.md).
  parserCsv(contenuCsv: string): LigneReleveCsvAvecId[] {
    const lignesBrutes = parserReleveCsv(contenuCsv);
    return lignesBrutes.map((ligne, index) => ({ id: `ligne-${index}`, ...ligne }));
  }

  async findAll(filtres: FindAllDepensesFiltres) {
    const conditions = [isNull(depense.archivedAt)];
    // Scoping multi-tenant — même mécanisme que TachesService.findAll
    // (commit b5f503f, 2026-08-31 : findAll() non scopé par organisation
    // était un bug, corrigé après coup) : toute requête HTTP réelle passe
    // par le JwtAuthGuard global, donc getUtilisateurId() y est toujours
    // résolvable.
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      const utilisateur = await this.usersService.findById(utilisateurId);
      if (utilisateur) {
        conditions.push(eq(depense.organisationId, utilisateur.organisationId));
      }
    }
    if (filtres.categorie) {
      conditions.push(eq(depense.categorie, filtres.categorie));
    }
    if (filtres.bienId) {
      conditions.push(eq(depense.bienId, filtres.bienId));
    }
    if (filtres.sciId) {
      conditions.push(eq(depense.sciId, filtres.sciId));
    }
    if (filtres.dateDebut) {
      conditions.push(gte(depense.dateDepense, filtres.dateDebut));
    }
    if (filtres.dateFin) {
      conditions.push(lte(depense.dateDepense, filtres.dateFin));
    }
    const lignes = await this.db
      .select()
      .from(depense)
      .where(and(...conditions));
    return lignes.map((ligne) => this.versDto(ligne));
  }

  private versDto(ligne: DepenseRow) {
    return {
      id: ligne.id,
      categorie: ligne.categorie,
      montant: ligne.montant,
      dateDepense: ligne.dateDepense,
      libelle: ligne.libelle,
      bienId: ligne.bienId,
      sciId: ligne.sciId,
      organisationId: ligne.organisationId,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt
    };
  }
}
