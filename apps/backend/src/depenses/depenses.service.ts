import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { parserReleveCsv, suggererCategorie, type LigneReleveCsvAvecId } from "core";
import { bien, depense, type Database } from "db";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { ReglesCategorisationService } from "../regles-categorisation/regles-categorisation.service";
import { UsersService } from "../users/users.service";
import type { DepenseCategorie } from "./depense-categories";
import type { CreateDepenseDto } from "./dto/create-depense.dto";

export interface FindAllDepensesFiltres {
  categorie?: CreateDepenseDto["categorie"];
  bienId?: string;
  sciId?: string;
  dateDebut?: string;
  dateFin?: string;
}

export interface LigneCandidateDepense extends LigneReleveCsvAvecId {
  // Module Charges et fiscalité, Étape 2 : présélection uniquement — voir
  // suggererCategorie (packages/core). null si aucune règle ne correspond
  // ou si plusieurs règles correspondent (jamais de choix arbitraire).
  categorieSuggeree: DepenseCategorie | null;
}

type DepenseRow = typeof depense.$inferSelect;

@Injectable()
export class DepensesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService,
    private readonly reglesCategorisationService: ReglesCategorisationService
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

  // Analyse pure côté écriture : aucune dépense n'est créée ici, seules les
  // lignes brutes du relevé sont renvoyées pour sélection manuelle de
  // catégorie + confirmation ligne par ligne côté frontend (chaque
  // confirmation appelle ensuite create() séparément) — jamais de
  // rapprochement automatique contre des dépenses existantes (contrairement
  // à PaiementsService.rapprocherCsv). Chaque ligne est enrichie d'une
  // catégorie suggérée (Étape 2, docs/backlog.md) via suggererCategorie —
  // une PRÉSÉLECTION uniquement, le formulaire existant reste modifiable
  // et la confirmation manuelle ligne par ligne reste obligatoire, aucun
  // changement à ce principe.
  async parserCsv(userId: string, contenuCsv: string): Promise<LigneCandidateDepense[]> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    const lignesBrutes = parserReleveCsv(contenuCsv);
    const regles = await this.reglesCategorisationService.findAllActives(user.organisationId);
    return lignesBrutes.map((ligne, index) => ({
      id: `ligne-${index}`,
      ...ligne,
      // suggererCategorie est générique (packages/core, sans dépendance à
      // depense_categorie) — les valeurs proviennent exclusivement de
      // règles déjà validées par CreateRegleCategorisationDto à leur
      // création, ce cast est donc sûr.
      categorieSuggeree: suggererCategorie(
        ligne.libelle,
        regles.map((regle) => ({ motCle: regle.motCle, categorie: regle.categorie }))
      ) as DepenseCategorie | null
    }));
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
