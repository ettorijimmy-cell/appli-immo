import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  centimesVersMontant,
  montantEnCentimes,
  parserReleveCsv,
  repartirProportionnellement,
  suggererCategorie,
  type LigneReleveCsvAvecId
} from "core";
import { appartements, bien, depense, mettreAJourAvecAudit, type Database } from "db";
import { and, eq, gte, isNull, lte, ne } from "drizzle-orm";
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
  appartementId?: string;
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
    if (!dto.bienId && !dto.sciId && !dto.appartementId) {
      throw new BadRequestException("bienId, sciId ou appartementId est requis (au moins l'un des trois).");
    }

    // appartementId implique toujours un bien précis (appartements.bien_id
    // est NOT NULL) — résolu AVANT bienId/sciId pour pouvoir dériver
    // bienId quand seul appartementId est fourni (même principe de
    // dénormalisation que sciId depuis bien.sciId ci-dessous), et pour
    // détecter une incohérence si bienId est également fourni mais désigne
    // un bien différent de celui de l'appartement — jamais laissé passer
    // silencieusement (Module Régularisation des charges, Sous-commit A).
    let bienIdEffectif = dto.bienId ?? null;
    if (dto.appartementId) {
      const [appartementRattache] = await this.db
        .select()
        .from(appartements)
        .where(eq(appartements.id, dto.appartementId))
        .limit(1);
      if (!appartementRattache) {
        throw new NotFoundException("Appartement introuvable");
      }
      if (dto.bienId && appartementRattache.bienId !== dto.bienId) {
        throw new BadRequestException(
          "appartementId n'appartient pas au bien désigné par bienId — incohérence entre les deux valeurs transmises."
        );
      }
      bienIdEffectif = appartementRattache.bienId;
    }

    // sciId dénormalisé depuis bien.sciId quand un bien est identifié (via
    // bienId ou appartementId) — jamais la valeur transmise par le client
    // (bien.sciId est immuable après création, voir UpdateBienDto, donc
    // aucun risque d'incohérence future à figer la valeur ici). Mirroring
    // bien.organisationId (packages/db/src/schema/bien.ts), même principe
    // de dénormalisation.
    let sciId: string | null = dto.sciId ?? null;
    if (bienIdEffectif) {
      const [bienRattache] = await this.db.select().from(bien).where(eq(bien.id, bienIdEffectif)).limit(1);
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
        bienId: bienIdEffectif,
        appartementId: dto.appartementId ?? null,
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
    // par le JwtAuthGuard global, donc getOrganisationId() y est toujours
    // résolvable. Lu directement depuis le JWT décodé (Commit 2,
    // docs/data-dictionary.md), jamais un lookup UsersService.
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      conditions.push(eq(depense.organisationId, organisationId));
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
    if (filtres.appartementId) {
      conditions.push(eq(depense.appartementId, filtres.appartementId));
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

  /**
   * Calcule l'aperçu d'une répartition sans rien écrire — Module
   * Régularisation des charges, Sous-commit D : le frontend doit pouvoir
   * montrer la base utilisée et la part de chaque lot avant toute
   * confirmation (opération irréversible, jamais d'exécution silencieuse).
   * Mêmes vérifications que `repartirDepenseEntreLots` ci-dessous, sauf la
   * transaction (lecture seule) — une répartition concurrente entre cet
   * aperçu et la confirmation reste possible (fenêtre de race bénigne :
   * `repartirDepenseEntreLots` revérifie tout avant d'écrire, l'aperçu
   * serait alors simplement rejeté à la confirmation, jamais une
   * double-écriture).
   */
  async previsualiserRepartition(depenseId: string, userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    const depenseSource = await this.chargerDepenseSourceRepartissable(this.db, depenseId, user.organisationId);
    const { cle, appartementsEligibles, parts } = await this.calculerRepartition(this.db, depenseSource);
    const appartementParId = new Map(appartementsEligibles.map((a) => [a.id, a]));

    return {
      cle,
      montantTotal: depenseSource.montant,
      parts: parts.map((part) => ({
        appartementId: part.id,
        numero: appartementParId.get(part.id)?.numero ?? "",
        montant: centimesVersMontant(part.montantCentimes)
      }))
    };
  }

  /**
   * Répartit une dépense de niveau bien (charge commune d'immeuble) entre
   * tous les appartements éligibles — Module Régularisation des charges,
   * Sous-commit D, docs/backlog.md. Posée sur DepensesService (pas
   * RegularisationChargesService) : cette opération crée/modifie des
   * `depense`, elle ne calcule aucun bilan de régularisation — les
   * dépenses enfants qu'elle produit sont simplement de futures lignes
   * imputables au logement, consommées plus tard par
   * RegularisationChargesService.calculerBilanPourBail exactement comme
   * n'importe quelle autre dépense `appartementId` renseigné.
   *
   * Clé de répartition : tantième si TOUS les lots éligibles en ont un
   * renseigné, sinon surface pour TOUS les lots — jamais de mélange des
   * deux unités dans un même calcul (décision actée avec l'utilisateur).
   * Garde-fou anti-double-répartition : `depenseSourceId` sert à la fois
   * de trace et de verrou — une dépense qui en a déjà (elle-même un
   * enfant) ou qui a déjà des enfants (déjà répartie) est rejetée.
   * Opération irréversible, toute entière dans une transaction.
   */
  async repartirDepenseEntreLots(depenseId: string, userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    return this.db.transaction(async (tx) => {
      const depenseSource = await this.chargerDepenseSourceRepartissable(tx, depenseId, user.organisationId, true);
      const { cle, parts } = await this.calculerRepartition(tx, depenseSource);

      const dateOperation = new Date().toISOString().slice(0, 10);
      const enfants = [];
      for (const part of parts) {
        const [enfant] = await tx
          .insert(depense)
          .values({
            categorie: depenseSource.categorie,
            montant: centimesVersMontant(part.montantCentimes),
            dateDepense: depenseSource.dateDepense,
            libelle: depenseSource.libelle,
            bienId: depenseSource.bienId,
            appartementId: part.id,
            sciId: depenseSource.sciId,
            depenseSourceId: depenseSource.id,
            organisationId: depenseSource.organisationId
          })
          .returning();
        if (!enfant) {
          throw new Error("Échec de la création d'une dépense enfant");
        }
        enfants.push(enfant);
      }

      // Cast explicite du résultat : la FK auto-référentielle de
      // depense_source_id (packages/db/src/schema/depense.ts) dégrade
      // l'inférence générique de mettreAJourAvecAudit sur cette table
      // précise (tous les champs ressortent `| null`, y compris `id`) —
      // même limite de typage Drizzle que celle déjà documentée sur
      // `table as never` dans mettreAJourAvecAudit lui-même.
      const [sourceMiseAJour] = (await mettreAJourAvecAudit(
        tx,
        depense,
        depenseId,
        {
          montant: "0.00",
          libelle: `${depenseSource.libelle} — réparti entre les lots le ${dateOperation}, montant original : ${depenseSource.montant} €`
        },
        this.requestContext.getUtilisateurId()
      )) as DepenseRow[];
      if (!sourceMiseAJour) {
        throw new Error("Échec de la mise à jour de la dépense source");
      }

      return {
        cle,
        source: this.versDto(sourceMiseAJour),
        enfants: enfants.map((e) => this.versDto(e))
      };
    });
  }

  // Vérifications communes à l'aperçu et à l'exécution : rattachement
  // bien-sans-appartement, pas déjà un enfant, pas déjà réparti. `dbOrTx`
  // paramétrable pour que repartirDepenseEntreLots puisse les exécuter
  // DANS sa transaction (jamais une lecture hors transaction suivie d'une
  // écriture — fenêtre de race sinon entre la vérification et l'INSERT).
  //
  // `verrouiller` (SELECT ... FOR UPDATE, revue financial-logic-reviewer
  // 2026-10-02) : sans lui, deux appels concurrents à
  // repartirDepenseEntreLots sur la même dépense peuvent tous les deux
  // passer la vérification "pas déjà d'enfant" avant qu'aucun des deux
  // n'ait committé ses INSERT — double répartition silencieuse, contraire
  // à l'exigence explicite. Avec le verrou, la seconde transaction bloque
  // sur le SELECT jusqu'à ce que la première committe (ou annule) ; une
  // fois débloquée, sa propre vérification "pas déjà d'enfant" voit alors
  // les enfants déjà créés et rejette correctement. Jamais appliqué sur le
  // chemin de lecture seule (previsualiserRepartition) : un verrou hors
  // transaction explicite n'a aucun effet utile et ajouterait une
  // contention inutile sur un simple aperçu.
  private async chargerDepenseSourceRepartissable(
    dbOrTx: Pick<Database, "select">,
    depenseId: string,
    organisationId: string,
    verrouiller = false
  ): Promise<DepenseRow> {
    const requete = dbOrTx.select().from(depense).where(eq(depense.id, depenseId)).limit(1);
    const [depenseSource] = verrouiller ? await requete.for("update") : await requete;
    if (!depenseSource || depenseSource.organisationId !== organisationId) {
      throw new NotFoundException("Dépense introuvable");
    }
    if (!depenseSource.bienId) {
      throw new BadRequestException("Seule une dépense rattachée à un bien peut être répartie entre les lots.");
    }
    if (depenseSource.appartementId) {
      throw new BadRequestException(
        "Cette dépense est déjà rattachée à un appartement précis — il n'y a rien à répartir."
      );
    }
    if (depenseSource.depenseSourceId) {
      throw new BadRequestException(
        "Cette dépense est elle-même issue d'une répartition précédente — elle ne peut pas être répartie à son tour."
      );
    }
    const [enfantExistant] = await dbOrTx
      .select({ id: depense.id })
      .from(depense)
      .where(eq(depense.depenseSourceId, depenseId))
      .limit(1);
    if (enfantExistant) {
      throw new BadRequestException(
        "Cette dépense a déjà été répartie entre les lots — une répartition ne peut jamais être exécutée deux fois."
      );
    }
    return depenseSource;
  }

  // Détermine la clé (tantième ou surface, jamais un mélange) et calcule
  // la répartition proportionnelle — partagé entre l'aperçu et l'exécution
  // réelle pour ne jamais faire diverger les deux calculs.
  private async calculerRepartition(
    dbOrTx: Pick<Database, "select">,
    depenseSource: DepenseRow
  ): Promise<{
    cle: "tantieme" | "surface";
    appartementsEligibles: (typeof appartements.$inferSelect)[];
    parts: ReturnType<typeof repartirProportionnellement>;
  }> {
    const appartementsEligibles = await dbOrTx
      .select()
      .from(appartements)
      .where(
        and(
          eq(appartements.bienId, depenseSource.bienId!),
          isNull(appartements.archivedAt),
          ne(appartements.statut, "archive")
        )
      );
    if (appartementsEligibles.length === 0) {
      throw new BadRequestException("Aucun appartement éligible sur ce bien — il n'y a rien à répartir.");
    }

    const tousOntTantieme = appartementsEligibles.every((a) => a.tantieme !== null);
    let cle: "tantieme" | "surface";
    if (tousOntTantieme) {
      cle = "tantieme";
    } else {
      const tousOntSurface = appartementsEligibles.every((a) => a.surface !== null);
      if (!tousOntSurface) {
        // Les lots listés sont ceux sans surface (la clé de repli tentée
        // une fois le tantième écarté) — pas uniquement ceux sans AUCUNE
        // des deux valeurs : un lot peut avoir un tantième mais pas de
        // surface (ou l'inverse sur un autre lot), le rejet se déclenche
        // alors sans qu'aucun lot n'ait les deux valeurs manquantes à la
        // fois (revue financial-logic-reviewer, 2026-10-02 — la version
        // précédente filtrait sur "ni l'un ni l'autre" et produisait un
        // message vide dans ce cas composite).
        const lotsSansSurface = appartementsEligibles.filter((a) => a.surface === null).map((a) => a.numero);
        throw new BadRequestException(
          `Répartition impossible : au moins un lot n'a pas de tantième renseigné, ce qui impose la surface comme clé de repli pour TOUS les lots — lot(s) sans surface renseignée : ${lotsSansSurface.join(", ")}.`
        );
      }
      cle = "surface";
    }

    const poids = appartementsEligibles.map((a) => ({
      id: a.id,
      poids: Number(cle === "tantieme" ? a.tantieme : a.surface)
    }));
    const totalCentimes = montantEnCentimes(depenseSource.montant);
    const parts = repartirProportionnellement(totalCentimes, poids);

    return { cle, appartementsEligibles, parts };
  }

  private versDto(ligne: DepenseRow) {
    return {
      id: ligne.id,
      categorie: ligne.categorie,
      montant: ligne.montant,
      dateDepense: ligne.dateDepense,
      libelle: ligne.libelle,
      bienId: ligne.bienId,
      appartementId: ligne.appartementId,
      depenseSourceId: ligne.depenseSourceId,
      sciId: ligne.sciId,
      organisationId: ligne.organisationId,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt
    };
  }
}
