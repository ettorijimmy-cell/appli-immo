import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculerStatutEtatDesLieux } from "core";
import {
  elementsInventaireMeuble,
  etatDesLieuxCles,
  etatDesLieuxCompteurs,
  etatDesLieuxEquipementsDivers,
  etatDesLieuxInventaire,
  etatDesLieuxPieceCuisine,
  etatDesLieuxPieceEntree,
  etatDesLieuxPieceSejour,
  etatDesLieuxPiecesAutre,
  etatDesLieuxPiecesChambre,
  etatDesLieuxPiecesSalleDeBain,
  etatDesLieuxPiecesWc,
  etatsDesLieux,
  mettreAJourAvecAudit,
  type Database
} from "db";
import { and, eq, isNull, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateEtatDesLieuxDto } from "./dto/create-etat-des-lieux.dto";
import type { EtatElementDto } from "./dto/etat-element.dto";
import type { SubmitClesDto } from "./dto/submit-cles.dto";
import type { SubmitCompteursDto } from "./dto/submit-compteurs.dto";
import type { SubmitEquipementsDiversDto } from "./dto/submit-equipements-divers.dto";
import type { SubmitInventaireDto } from "./dto/submit-inventaire.dto";
import type { SubmitPieceAutreDto } from "./dto/submit-piece-autre.dto";
import type { SubmitPieceChambreDto } from "./dto/submit-piece-chambre.dto";
import type { SubmitPieceCuisineDto } from "./dto/submit-piece-cuisine.dto";
import type { SubmitPieceEntreeDto } from "./dto/submit-piece-entree.dto";
import type { SubmitPieceSalleDeBainDto } from "./dto/submit-piece-salle-de-bain.dto";
import type { SubmitPieceSejourDto } from "./dto/submit-piece-sejour.dto";
import type { SubmitPieceWcDto } from "./dto/submit-piece-wc.dto";
import type { UpdateEtatDesLieuxDto } from "./dto/update-etat-des-lieux.dto";

// La DTO expose les éléments (mur, sol, prises...) comme des objets
// imbriqués pour coller au parcours mobile pas-à-pas (un élément à la
// fois) ; le schéma reste littéral et plat (CLAUDE.md, Option B). Ces
// fonctions font le pont, en ne recopiant que les clés effectivement
// fournies (jamais d'écrasement à `undefined` d'une valeur déjà en base).
function aplatirElement(prefix: string, dto?: EtatElementDto): Record<string, unknown> {
  if (!dto) {
    return {};
  }
  const champs: Record<string, unknown> = {};
  if (dto.description !== undefined) {
    champs[`${prefix}Description`] = dto.description;
  }
  if (dto.etatEntree !== undefined) {
    champs[`${prefix}EtatEntree`] = dto.etatEntree;
  }
  if (dto.etatSortie !== undefined) {
    champs[`${prefix}EtatSortie`] = dto.etatSortie;
  }
  return champs;
}

interface SocleDto {
  mur?: EtatElementDto;
  sol?: EtatElementDto;
  vitrageVolets?: EtatElementDto;
  plafond?: EtatElementDto;
  eclairage?: EtatElementDto;
  prises?: EtatElementDto & { nombre?: number };
}

// Éléments communs à toutes les pièces du modèle réel.
function aplatirSocle(dto: SocleDto): Record<string, unknown> {
  const champs: Record<string, unknown> = {
    ...aplatirElement("mur", dto.mur),
    ...aplatirElement("sol", dto.sol),
    ...aplatirElement("vitrageVolets", dto.vitrageVolets),
    ...aplatirElement("plafond", dto.plafond),
    ...aplatirElement("eclairage", dto.eclairage),
    ...aplatirElement("prises", dto.prises)
  };
  if (dto.prises?.nombre !== undefined) {
    champs.prisesNombre = dto.prises.nombre;
  }
  return champs;
}

function champsPieceEntree(dto: SubmitPieceEntreeDto) {
  return {
    ...aplatirSocle(dto),
    ...aplatirElement("porte", dto.porte),
    ...aplatirElement("sonnette", dto.sonnette)
  };
}

function champsPieceSejour(dto: SubmitPieceSejourDto) {
  return aplatirSocle(dto);
}

function champsPieceCuisine(dto: SubmitPieceCuisineDto) {
  const champs: Record<string, unknown> = {
    ...aplatirSocle(dto),
    ...aplatirElement("placards", dto.placards),
    ...aplatirElement("evier", dto.evier),
    ...aplatirElement("plaquesCuisson", dto.plaquesCuisson),
    ...aplatirElement("hotte", dto.hotte)
  };
  if (dto.electromenagerDescription !== undefined) {
    champs.electromenagerDescription = dto.electromenagerDescription;
  }
  return champs;
}

function champsPieceAvecNumero(dto: SubmitPieceChambreDto) {
  return aplatirSocle(dto);
}

function champsPieceSalleDeBain(dto: SubmitPieceSalleDeBainDto) {
  return {
    ...aplatirSocle(dto),
    ...aplatirElement("lavabo", dto.lavabo),
    ...aplatirElement("baignoire", dto.baignoire)
  };
}

function champsPieceWc(dto: SubmitPieceWcDto) {
  return {
    ...aplatirSocle(dto),
    ...aplatirElement("lavabo", dto.lavabo),
    ...aplatirElement("wc", dto.wc)
  };
}

function champsPieceAutre(dto: SubmitPieceAutreDto) {
  return {
    ...aplatirSocle(dto),
    libelle: dto.libelle
  };
}

function champDecimal(valeur: string | undefined, champs: Record<string, unknown>, cle: string) {
  if (valeur !== undefined) {
    champs[cle] = valeur;
  }
}

// Ne garde que les clés effectivement fournies par le client — une ligne
// de soumission de sortie qui ne renvoie pas les champs d'entrée ne doit
// jamais les écraser à `undefined` (même principe qu'aplatirElement).
function champsDefinis(obj: Record<string, unknown>): Record<string, unknown> {
  const champs: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(obj)) {
    if (valeur !== undefined) {
      champs[cle] = valeur;
    }
  }
  return champs;
}

function champsCompteurs(dto: SubmitCompteursDto) {
  const champs: Record<string, unknown> = {};
  const electricite = dto.electricite;
  if (electricite) {
    champDecimal(electricite.numeroCompteurEntree, champs, "electriciteNumeroCompteurEntree");
    champDecimal(electricite.numeroCompteurSortie, champs, "electriciteNumeroCompteurSortie");
    champDecimal(electricite.releveHpEntree, champs, "electriciteReleveHpEntree");
    champDecimal(electricite.releveHpSortie, champs, "electriciteReleveHpSortie");
    champDecimal(electricite.releveHcEntree, champs, "electriciteReleveHcEntree");
    champDecimal(electricite.releveHcSortie, champs, "electriciteReleveHcSortie");
    champDecimal(electricite.ancienOccupantEntree, champs, "electriciteAncienOccupantEntree");
    champDecimal(electricite.ancienOccupantSortie, champs, "electriciteAncienOccupantSortie");
  }
  const gaz = dto.gaz;
  if (gaz) {
    champDecimal(gaz.numeroCompteurEntree, champs, "gazNumeroCompteurEntree");
    champDecimal(gaz.numeroCompteurSortie, champs, "gazNumeroCompteurSortie");
    champDecimal(gaz.releveEntree, champs, "gazReleveEntree");
    champDecimal(gaz.releveSortie, champs, "gazReleveSortie");
  }
  const eau = dto.eau;
  if (eau) {
    champDecimal(eau.releveFroideEntree, champs, "eauReleveFroideEntree");
    champDecimal(eau.releveFroideSortie, champs, "eauReleveFroideSortie");
    champDecimal(eau.releveChaudeEntree, champs, "eauReleveChaudeEntree");
    champDecimal(eau.releveChaudeSortie, champs, "eauReleveChaudeSortie");
  }
  return champs;
}

@Injectable()
export class EtatsDesLieuxService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async getCatalogueInventaire() {
    return this.db
      .select()
      .from(elementsInventaireMeuble)
      .orderBy(elementsInventaireMeuble.categorie, elementsInventaireMeuble.ordreAffichage);
  }

  async create(dto: CreateEtatDesLieuxDto) {
    const [existant] = await this.db
      .select({ id: etatsDesLieux.id })
      .from(etatsDesLieux)
      .where(eq(etatsDesLieux.bailId, dto.bailId))
      .limit(1);
    if (existant) {
      throw new ConflictException("Un état des lieux existe déjà pour ce bail");
    }
    const [entete] = await this.db.insert(etatsDesLieux).values({ bailId: dto.bailId }).returning();
    if (!entete) {
      throw new Error("Échec de la création de l'état des lieux");
    }
    return this.versDto(entete);
  }

  // `avecArchives` : les lignes archivées de clés/équipements
  // divers/inventaire restent en base (jamais de DELETE, voir
  // upsertEtArchiverParId) mais sont masquées par défaut — même principe
  // que DocumentsService.findAll. Nécessaire pour que le composant
  // ArchiveToggle/ArchiveBadge partagé (apps/desktop) puisse les
  // réafficher, au lieu de les rendre définitivement invisibles.
  async findById(id: string, avecArchives = false) {
    const [entete] = await this.db.select().from(etatsDesLieux).where(eq(etatsDesLieux.id, id)).limit(1);
    if (!entete) {
      return null;
    }
    const filtreCles = avecArchives
      ? eq(etatDesLieuxCles.etatDesLieuxId, id)
      : and(eq(etatDesLieuxCles.etatDesLieuxId, id), isNull(etatDesLieuxCles.archivedAt));
    const filtreEquipementsDivers = avecArchives
      ? eq(etatDesLieuxEquipementsDivers.etatDesLieuxId, id)
      : and(eq(etatDesLieuxEquipementsDivers.etatDesLieuxId, id), isNull(etatDesLieuxEquipementsDivers.archivedAt));
    const filtreInventaire = avecArchives
      ? eq(etatDesLieuxInventaire.etatDesLieuxId, id)
      : and(eq(etatDesLieuxInventaire.etatDesLieuxId, id), isNull(etatDesLieuxInventaire.archivedAt));

    const [
      [entree],
      [sejour],
      [cuisine],
      chambres,
      sallesDeBain,
      wc,
      autres,
      [compteurs],
      cles,
      equipementsDivers,
      inventaire
    ] = await Promise.all([
      this.db.select().from(etatDesLieuxPieceEntree).where(eq(etatDesLieuxPieceEntree.etatDesLieuxId, id)).limit(1),
      this.db.select().from(etatDesLieuxPieceSejour).where(eq(etatDesLieuxPieceSejour.etatDesLieuxId, id)).limit(1),
      this.db.select().from(etatDesLieuxPieceCuisine).where(eq(etatDesLieuxPieceCuisine.etatDesLieuxId, id)).limit(1),
      this.db.select().from(etatDesLieuxPiecesChambre).where(eq(etatDesLieuxPiecesChambre.etatDesLieuxId, id)),
      this.db
        .select()
        .from(etatDesLieuxPiecesSalleDeBain)
        .where(eq(etatDesLieuxPiecesSalleDeBain.etatDesLieuxId, id)),
      this.db.select().from(etatDesLieuxPiecesWc).where(eq(etatDesLieuxPiecesWc.etatDesLieuxId, id)),
      this.db.select().from(etatDesLieuxPiecesAutre).where(eq(etatDesLieuxPiecesAutre.etatDesLieuxId, id)),
      this.db.select().from(etatDesLieuxCompteurs).where(eq(etatDesLieuxCompteurs.etatDesLieuxId, id)).limit(1),
      this.db.select().from(etatDesLieuxCles).where(filtreCles),
      this.db.select().from(etatDesLieuxEquipementsDivers).where(filtreEquipementsDivers),
      this.db
        .select({
          id: etatDesLieuxInventaire.id,
          elementId: etatDesLieuxInventaire.elementId,
          nombreEntree: etatDesLieuxInventaire.nombreEntree,
          etatEntree: etatDesLieuxInventaire.etatEntree,
          nombreSortie: etatDesLieuxInventaire.nombreSortie,
          etatSortie: etatDesLieuxInventaire.etatSortie,
          commentaire: etatDesLieuxInventaire.commentaire,
          archivedAt: etatDesLieuxInventaire.archivedAt,
          elementCode: elementsInventaireMeuble.code,
          elementLibelle: elementsInventaireMeuble.libelle,
          elementCategorie: elementsInventaireMeuble.categorie,
          elementOrdreAffichage: elementsInventaireMeuble.ordreAffichage
        })
        .from(etatDesLieuxInventaire)
        .innerJoin(elementsInventaireMeuble, eq(etatDesLieuxInventaire.elementId, elementsInventaireMeuble.id))
        .where(filtreInventaire)
    ]);

    return {
      ...this.versDto(entete),
      entree: entree ?? null,
      sejour: sejour ?? null,
      cuisine: cuisine ?? null,
      chambres,
      sallesDeBain,
      wc,
      autres,
      compteurs: compteurs ?? null,
      cles,
      equipementsDivers,
      inventaire
    };
  }

  async findByBailId(bailId: string, avecArchives = false) {
    const [entete] = await this.db
      .select({ id: etatsDesLieux.id })
      .from(etatsDesLieux)
      .where(eq(etatsDesLieux.bailId, bailId))
      .limit(1);
    if (!entete) {
      return null;
    }
    return this.findById(entete.id, avecArchives);
  }

  async updateHeader(id: string, dto: UpdateEtatDesLieuxDto) {
    const [entete] = await mettreAJourAvecAudit(
      this.db,
      etatsDesLieux,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!entete) {
      throw new NotFoundException("État des lieux introuvable");
    }
    // mettreAJourAvecAudit est générique sur T extends TableAvecAudit : son
    // type de retour inféré élargit les colonnes propres à `etatsDesLieux`
    // (au-delà d'id/version/updatedAt/updatedBy) — la ligne existe bel et
    // bien avec sa forme complète (WHERE id = ... vient de matcher), ce cast
    // ne fait que rétablir un type déjà correct à l'exécution (même
    // pattern que DocumentsService.update).
    return this.versDto(entete as typeof etatsDesLieux.$inferSelect);
  }

  private versDto(entete: typeof etatsDesLieux.$inferSelect) {
    return {
      ...entete,
      statut: calculerStatutEtatDesLieux(entete.dateEntree, entete.dateSortie)
    };
  }

  async submitPieceEntree(etatDesLieuxId: string, dto: SubmitPieceEntreeDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertUnique(etatDesLieuxPieceEntree, etatDesLieuxId, champsPieceEntree(dto));
  }

  async submitPieceSejour(etatDesLieuxId: string, dto: SubmitPieceSejourDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertUnique(etatDesLieuxPieceSejour, etatDesLieuxId, champsPieceSejour(dto));
  }

  async submitPieceCuisine(etatDesLieuxId: string, dto: SubmitPieceCuisineDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertUnique(etatDesLieuxPieceCuisine, etatDesLieuxId, champsPieceCuisine(dto));
  }

  async submitPieceChambre(etatDesLieuxId: string, dto: SubmitPieceChambreDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertParNumero(etatDesLieuxPiecesChambre, etatDesLieuxId, dto.numero, champsPieceAvecNumero(dto));
  }

  async submitPieceSalleDeBain(etatDesLieuxId: string, dto: SubmitPieceSalleDeBainDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertParNumero(
      etatDesLieuxPiecesSalleDeBain,
      etatDesLieuxId,
      dto.numero,
      champsPieceSalleDeBain(dto)
    );
  }

  async submitPieceWc(etatDesLieuxId: string, dto: SubmitPieceWcDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertParNumero(etatDesLieuxPiecesWc, etatDesLieuxId, dto.numero, champsPieceWc(dto));
  }

  async submitPieceAutre(etatDesLieuxId: string, dto: SubmitPieceAutreDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertParNumero(etatDesLieuxPiecesAutre, etatDesLieuxId, dto.numero, champsPieceAutre(dto));
  }

  async submitCompteurs(etatDesLieuxId: string, dto: SubmitCompteursDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertUnique(etatDesLieuxCompteurs, etatDesLieuxId, champsCompteurs(dto));
  }

  async submitCles(etatDesLieuxId: string, dto: SubmitClesDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertEtArchiverParId(
      etatDesLieuxCles,
      etatDesLieuxId,
      dto.lignes.map((ligne) => ({
        id: ligne.id,
        champs: champsDefinis({
          typeCle: ligne.typeCle,
          libelleAutre: ligne.libelleAutre,
          nombreEntree: ligne.nombreEntree,
          nombreSortie: ligne.nombreSortie,
          commentaire: ligne.commentaire
        })
      })),
      dto.idsASupprimer ?? []
    );
  }

  async submitEquipementsDivers(etatDesLieuxId: string, dto: SubmitEquipementsDiversDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertEtArchiverParId(
      etatDesLieuxEquipementsDivers,
      etatDesLieuxId,
      dto.lignes.map((ligne) => ({
        id: ligne.id,
        champs: champsDefinis({
          libelle: ligne.libelle,
          nombreEntree: ligne.nombreEntree,
          etatEntree: ligne.etatEntree,
          nombreSortie: ligne.nombreSortie,
          etatSortie: ligne.etatSortie,
          commentaire: ligne.commentaire
        })
      })),
      dto.idsASupprimer ?? []
    );
  }

  async submitInventaire(etatDesLieuxId: string, dto: SubmitInventaireDto) {
    await this.verifierExiste(etatDesLieuxId);
    return this.upsertEtArchiverParElementId(
      etatDesLieuxId,
      dto.lignes.map((ligne) => ({
        elementId: ligne.elementId,
        champs: champsDefinis({
          nombreEntree: ligne.nombreEntree,
          etatEntree: ligne.etatEntree,
          nombreSortie: ligne.nombreSortie,
          etatSortie: ligne.etatSortie,
          commentaire: ligne.commentaire
        })
      })),
      dto.elementsASupprimer ?? []
    );
  }

  private async verifierExiste(etatDesLieuxId: string): Promise<void> {
    const [entete] = await this.db
      .select({ id: etatsDesLieux.id })
      .from(etatsDesLieux)
      .where(eq(etatsDesLieux.id, etatDesLieuxId))
      .limit(1);
    if (!entete) {
      throw new NotFoundException("État des lieux introuvable");
    }
  }

  // Upsert d'une table 1:1 avec l'état des lieux (contrainte unique sur
  // etat_des_lieux_id) : entrée, séjour, cuisine, compteurs.
  private async upsertUnique<
    T extends PgTable & {
      id: AnyColumn;
      etatDesLieuxId: AnyColumn;
      version: AnyColumn;
      updatedAt: AnyColumn;
      updatedBy: AnyColumn;
    }
  >(table: T, etatDesLieuxId: string, champs: Record<string, unknown>) {
    const utilisateurId = this.requestContext.getUtilisateurId();
    const [existant] = await this.db
      .select()
      .from(table)
      .where(eq(table.etatDesLieuxId, etatDesLieuxId))
      .limit(1);
    if (existant) {
      const [ligne] = await mettreAJourAvecAudit(this.db, table, (existant as { id: string }).id, champs, utilisateurId);
      if (!ligne) {
        throw new NotFoundException("État des lieux introuvable");
      }
      return ligne;
    }
    const [ligne] = await this.db
      .insert(table)
      .values({ etatDesLieuxId, ...champs } as T["$inferInsert"])
      .returning();
    if (!ligne) {
      throw new Error("Échec de l'enregistrement de la pièce");
    }
    return ligne;
  }

  // Upsert d'une table à occurrences multiples, clé (etat_des_lieux_id,
  // numero) : chambres, salles de bain, wc, autres pièces.
  private async upsertParNumero<
    T extends PgTable & {
      id: AnyColumn;
      etatDesLieuxId: AnyColumn;
      numero: AnyColumn;
      version: AnyColumn;
      updatedAt: AnyColumn;
      updatedBy: AnyColumn;
    }
  >(table: T, etatDesLieuxId: string, numero: number, champs: Record<string, unknown>) {
    const utilisateurId = this.requestContext.getUtilisateurId();
    const [existant] = await this.db
      .select()
      .from(table)
      .where(and(eq(table.etatDesLieuxId, etatDesLieuxId), eq(table.numero, numero)))
      .limit(1);
    if (existant) {
      const [ligne] = await mettreAJourAvecAudit(this.db, table, (existant as { id: string }).id, champs, utilisateurId);
      if (!ligne) {
        throw new NotFoundException("État des lieux introuvable");
      }
      return ligne;
    }
    const [ligne] = await this.db
      .insert(table)
      .values({ etatDesLieuxId, numero, ...champs } as T["$inferInsert"])
      .returning();
    if (!ligne) {
      throw new Error("Échec de l'enregistrement de la pièce");
    }
    return ligne;
  }

  // Upsert par id explicite pour une liste (clés, équipements divers) :
  // jamais un remplacement en bloc. Une ligne sans id est une nouvelle
  // ligne ; une ligne avec un id qui ne correspond à aucune ligne
  // existante est une erreur (id périmé ou étranger) ; une ligne
  // existante non mentionnée dans `lignes` n'est jamais touchée. La
  // suppression n'est jamais implicite : seuls les ids listés dans
  // `idsASupprimer` sont archivés (jamais de DELETE sur une table
  // métier, CLAUDE.md). Sans cette contrainte, une soumission de sortie
  // qui ne renverrait pas les lignes déjà saisies à l'entrée les aurait
  // silencieusement effacées.
  private async upsertEtArchiverParId<
    T extends PgTable & {
      id: AnyColumn;
      etatDesLieuxId: AnyColumn;
      archivedAt: AnyColumn;
      version: AnyColumn;
      updatedAt: AnyColumn;
      updatedBy: AnyColumn;
    }
  >(
    table: T,
    etatDesLieuxId: string,
    lignes: { id?: string | undefined; champs: Record<string, unknown> }[],
    idsASupprimer: string[]
  ) {
    const utilisateurId = this.requestContext.getUtilisateurId();
    return this.db.transaction(async (tx) => {
      const existantes = await tx
        .select()
        .from(table)
        .where(and(eq(table.etatDesLieuxId, etatDesLieuxId), isNull(table.archivedAt)));
      const idsExistants = new Set(existantes.map((ligne) => (ligne as { id: string }).id));

      for (const ligne of lignes) {
        if (ligne.id) {
          if (!idsExistants.has(ligne.id)) {
            throw new NotFoundException(`Ligne ${ligne.id} introuvable pour cet état des lieux`);
          }
          const [misAJour] = await mettreAJourAvecAudit(tx, table, ligne.id, ligne.champs, utilisateurId);
          if (!misAJour) {
            throw new NotFoundException(`Ligne ${ligne.id} introuvable pour cet état des lieux`);
          }
        } else {
          await tx.insert(table).values({ etatDesLieuxId, ...ligne.champs } as T["$inferInsert"]);
        }
      }

      for (const id of idsASupprimer) {
        if (!idsExistants.has(id)) {
          throw new NotFoundException(`Ligne ${id} introuvable pour cet état des lieux`);
        }
        const [archivee] = await mettreAJourAvecAudit(tx, table, id, { archivedAt: new Date() }, utilisateurId);
        if (!archivee) {
          throw new NotFoundException(`Ligne ${id} introuvable pour cet état des lieux`);
        }
      }

      return tx
        .select()
        .from(table)
        .where(and(eq(table.etatDesLieuxId, etatDesLieuxId), isNull(table.archivedAt)));
    });
  }

  // Même principe que upsertEtArchiverParId, mais pour l'inventaire
  // meublé : elementId est déjà une clé naturelle stable (contrainte
  // d'unicité (etat_des_lieux_id, element_id) en base), pas besoin d'un
  // id de ligne allé-retour côté client.
  private async upsertEtArchiverParElementId(
    etatDesLieuxId: string,
    lignes: { elementId: string; champs: Record<string, unknown> }[],
    elementsASupprimer: string[]
  ) {
    const utilisateurId = this.requestContext.getUtilisateurId();
    return this.db.transaction(async (tx) => {
      const existantes = await tx
        .select()
        .from(etatDesLieuxInventaire)
        .where(
          and(eq(etatDesLieuxInventaire.etatDesLieuxId, etatDesLieuxId), isNull(etatDesLieuxInventaire.archivedAt))
        );
      const parElementId = new Map(existantes.map((ligne) => [ligne.elementId, ligne]));

      for (const ligne of lignes) {
        const existante = parElementId.get(ligne.elementId);
        if (existante) {
          await mettreAJourAvecAudit(tx, etatDesLieuxInventaire, existante.id, ligne.champs, utilisateurId);
        } else {
          await tx
            .insert(etatDesLieuxInventaire)
            .values({ etatDesLieuxId, elementId: ligne.elementId, ...ligne.champs });
        }
      }

      for (const elementId of elementsASupprimer) {
        const existante = parElementId.get(elementId);
        if (!existante) {
          throw new NotFoundException(`Élément ${elementId} introuvable dans l'inventaire de cet état des lieux`);
        }
        await mettreAJourAvecAudit(
          tx,
          etatDesLieuxInventaire,
          existante.id,
          { archivedAt: new Date() },
          utilisateurId
        );
      }

      return tx
        .select()
        .from(etatDesLieuxInventaire)
        .where(
          and(eq(etatDesLieuxInventaire.etatDesLieuxId, etatDesLieuxId), isNull(etatDesLieuxInventaire.archivedAt))
        );
    });
  }
}
