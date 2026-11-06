import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  avertissementDateEntreePapier,
  contenuEstUnPdf,
  refusDateEntreePapier,
  TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS
} from "core";
import {
  bailLocataires,
  baux,
  documents,
  etatDesLieuxEntreePapier,
  etatsDesLieux,
  locataires,
  mettreAJourAvecAudit,
  type Database,
  type SignataireEntreePapier
} from "db";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { dateDuJourParis } from "../common/date-paris";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { construireCheminStockage } from "../documents/storage/construire-chemin-stockage";
import { resoudrePhasesSigneesEtatDesLieux } from "../etats-des-lieux-signature/resoudre-phase-etat-des-lieux";
import { EtatsDesLieuxService, MESSAGE_BROUILLON_ABANDONNE } from "../etats-des-lieux/etats-des-lieux.service";
import { OrganisationResolutionService } from "../organisation-resolution/organisation-resolution.service";
import { DocumentStorageService } from "../storage/document-storage.service";
import type { DeclarerEntreePapierDto } from "./dto/declarer-entree-papier.dto";

export const MESSAGE_ENTREE_SIGNEE_NUMERIQUEMENT =
  "Entrée papier refusée : l'entrée de cet état des lieux est déjà signée numériquement.";
export const MESSAGE_SCAN_OBLIGATOIRE =
  "Le scan PDF de l'état des lieux d'entrée papier est obligatoire pour une première déclaration.";
export const MESSAGE_SORTIE_SIGNEE =
  "Entrée papier refusée : la sortie de cet état des lieux est signée, l'entrée ne se corrige plus.";

// Codes Postgres : exclusion_violation (triggers de la migration 0075),
// unique_violation (une seule déclaration active, un scan par déclaration).
const CODE_POSTGRES_VIOLATION_EXCLUSION = "23P01";
const CODE_POSTGRES_VIOLATION_UNICITE = "23505";

const LIBELLE_PIECE: Record<string, string> = {
  entree: "Entrée",
  sejour: "Séjour",
  cuisine: "Cuisine",
  chambre: "Chambre",
  salle_de_bain: "Salle de bain",
  wc: "WC",
  autre: "Autre pièce"
};

function codePostgres(erreur: unknown): unknown {
  return typeof erreur === "object" && erreur !== null && "code" in erreur ? (erreur as { code: unknown }).code : undefined;
}

export interface ScanEntreePapier {
  nomFichier: string;
  contenu: Buffer;
}

// Déclaration d'une entrée d'état des lieux établie et signée sur papier
// (2026-11-06), et sa correction tant que la sortie n'est pas signée. Une
// correction écrit une nouvelle ligne et archive la précédente : l'ancien
// scan reste stocké et référencé (jamais effacé). Voir
// docs/data-dictionary.md, section etat_des_lieux_entree_papier.
@Injectable()
export class EtatDesLieuxEntreePapierService {
  private readonly logger = new Logger(EtatDesLieuxEntreePapierService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storage: DocumentStorageService,
    private readonly requestContext: RequestContextService,
    private readonly organisationResolution: OrganisationResolutionService,
    private readonly etatsDesLieuxService: EtatsDesLieuxService
  ) {}

  async declarer(etatDesLieuxId: string, dto: DeclarerEntreePapierDto, scan: ScanEntreePapier | undefined) {
    // Contrôles sans accès à la base d'abord : le fichier (s'il est
    // fourni) et la date. Sans fichier, seule une correction est possible :
    // elle reprend le scan de la déclaration active (vérifié plus bas).
    if (scan) {
      if (scan.contenu.byteLength === 0) {
        throw new BadRequestException("Le scan PDF de l'état des lieux d'entrée papier est vide.");
      }
      if (scan.contenu.byteLength > TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS) {
        throw new BadRequestException(
          `Le scan dépasse la taille maximale de ${TAILLE_MAX_SCAN_ENTREE_PAPIER_OCTETS / (1024 * 1024)} Mo.`
        );
      }
      if (!contenuEstUnPdf(scan.contenu)) {
        throw new BadRequestException("Le scan doit être un fichier PDF.");
      }
    }
    const aujourdHui = dateDuJourParis();
    const refusDate = refusDateEntreePapier(dto.dateSignature, aujourdHui);
    if (refusDate) {
      throw new BadRequestException(refusDate);
    }
    const lieu = dto.lieu.trim();
    const bailleurNom = dto.bailleurNom.trim();
    if (!lieu) {
      throw new BadRequestException("Le lieu de l'état des lieux d'entrée papier est obligatoire.");
    }
    if (!bailleurNom) {
      throw new BadRequestException("Le nom du bailleur ne peut pas être vide.");
    }

    const utilisateurId = await this.verifierAppartenance(etatDesLieuxId);
    const entete = await this.chargerEntete(etatDesLieuxId);
    const [bail] = await this.db
      .select({ dateDebut: baux.dateDebut })
      .from(baux)
      .where(eq(baux.id, entete.bailId))
      .limit(1);
    if (!bail) {
      throw new NotFoundException("État des lieux introuvable");
    }

    // Mêmes refus que la signature numérique, avant toute écriture, puis
    // relus sous verrou dans la transaction.
    await this.verifierPhases(this.db, etatDesLieuxId);
    const signataires = await this.resoudreSignataires(entete.bailId, bailleurNom, dto.locataireIds);
    await this.verifierPhotosEntreeArchivees(etatDesLieuxId);
    if (!scan && !(await this.declarationActive(this.db, etatDesLieuxId))) {
      throw new BadRequestException(MESSAGE_SCAN_OBLIGATOIRE);
    }

    // Nouveau scan : écrit avant la transaction (comme les signatures),
    // supprimé si elle échoue. Sans nouveau scan : rien n'est écrit ni
    // dupliqué, la nouvelle ligne reprend le document existant.
    const nouveauScan = scan
      ? (() => {
          const documentId = uuidv7();
          return {
            documentId,
            cheminStockage: construireCheminStockage("etat_des_lieux", etatDesLieuxId, documentId),
            ...scan
          };
        })()
      : null;
    if (nouveauScan) {
      await this.storage.enregistrer(nouveauScan.contenu, nouveauScan.cheminStockage);
    }
    try {
      await this.db.transaction(async (tx) => {
        // Même verrou de ligne que la signature et l'abandon : les trois
        // s'excluent.
        const [verrou] = await tx
          .select({ archivedAt: etatsDesLieux.archivedAt })
          .from(etatsDesLieux)
          .where(eq(etatsDesLieux.id, etatDesLieuxId))
          .for("update");
        if (!verrou || verrou.archivedAt) {
          throw new ConflictException(MESSAGE_BROUILLON_ABANDONNE);
        }
        await this.verifierPhases(tx, etatDesLieuxId);

        // Relue sous le verrou : c'est elle qui décide s'il s'agit d'une
        // correction, et quel scan reprendre.
        const active = await this.declarationActive(tx, etatDesLieuxId);
        let documentId: string;
        if (nouveauScan) {
          await tx.insert(documents).values({
            id: nouveauScan.documentId,
            entiteType: "etat_des_lieux",
            entiteId: etatDesLieuxId,
            categorie: "etat_des_lieux_entree_papier",
            nomFichier: nouveauScan.nomFichier || "etat-des-lieux-entree-papier.pdf",
            mimeType: "application/pdf",
            tailleOctets: nouveauScan.contenu.byteLength,
            cheminStockage: nouveauScan.cheminStockage,
            etatDesLieuxPhase: "entree"
          });
          documentId = nouveauScan.documentId;
        } else if (active) {
          documentId = active.documentId;
        } else {
          throw new BadRequestException(MESSAGE_SCAN_OBLIGATOIRE);
        }

        // Correction : la déclaration active est archivée AVANT l'insertion
        // de la nouvelle (index unique partiel sur la ligne active).
        if (active) {
          await mettreAJourAvecAudit(tx, etatDesLieuxEntreePapier, active.id, { archivedAt: new Date() }, utilisateurId);
        }
        await tx.insert(etatDesLieuxEntreePapier).values({
          etatDesLieuxId,
          dateSignature: dto.dateSignature,
          lieu,
          documentId,
          signataires,
          declareeLe: new Date(),
          declareePar: utilisateurId,
          updatedBy: utilisateurId
        });
        // date_entree et lieu_entree suivent la déclaration active, dans la
        // même transaction (jamais l'une sans l'autre).
        await mettreAJourAvecAudit(
          tx,
          etatsDesLieux,
          etatDesLieuxId,
          { dateEntree: dto.dateSignature, lieuEntree: lieu },
          utilisateurId
        );
      });
    } catch (erreur) {
      if (nouveauScan) {
        await this.nettoyerBlobOrphelin(nouveauScan.cheminStockage);
      }
      throw this.traduireErreurBase(erreur);
    }

    return {
      etatDesLieux: await this.etatsDesLieuxService.findById(etatDesLieuxId),
      avertissement: avertissementDateEntreePapier(dto.dateSignature, bail.dateDebut)
    };
  }

  // Historique complet, déclaration active comprise, la plus récente en
  // premier. Le scan se télécharge par GET /documents/:id/contenu.
  async historique(etatDesLieuxId: string) {
    await this.verifierAppartenance(etatDesLieuxId);
    await this.chargerEntete(etatDesLieuxId);
    const lignes = await this.db
      .select()
      .from(etatDesLieuxEntreePapier)
      .where(eq(etatDesLieuxEntreePapier.etatDesLieuxId, etatDesLieuxId))
      .orderBy(desc(etatDesLieuxEntreePapier.declareeLe), desc(etatDesLieuxEntreePapier.id));
    return lignes.map((ligne) => ({
      id: ligne.id,
      dateSignature: ligne.dateSignature,
      lieu: ligne.lieu,
      documentId: ligne.documentId,
      signataires: ligne.signataires,
      declareeLe: ligne.declareeLe,
      declareePar: ligne.declareePar,
      archivedAt: ligne.archivedAt
    }));
  }

  // Refuse en cas de doute, comme la signature : sans organisation ni
  // utilisateur, la déclaration est introuvable.
  private async verifierAppartenance(etatDesLieuxId: string): Promise<string> {
    const organisationId = this.requestContext.getOrganisationId();
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (!organisationId || !utilisateurId) {
      throw new NotFoundException("État des lieux introuvable");
    }
    const idsValides = await this.organisationResolution.resoudreEntiteIdsOrganisation("etat_des_lieux", organisationId);
    if (!idsValides.includes(etatDesLieuxId)) {
      throw new NotFoundException("État des lieux introuvable");
    }
    return utilisateurId;
  }

  private async declarationActive(
    db: Pick<Database, "select">,
    etatDesLieuxId: string
  ): Promise<{ id: string; documentId: string } | undefined> {
    const [active] = await db
      .select({ id: etatDesLieuxEntreePapier.id, documentId: etatDesLieuxEntreePapier.documentId })
      .from(etatDesLieuxEntreePapier)
      .where(and(eq(etatDesLieuxEntreePapier.etatDesLieuxId, etatDesLieuxId), isNull(etatDesLieuxEntreePapier.archivedAt)));
    return active;
  }

  private async chargerEntete(etatDesLieuxId: string) {
    const [entete] = await this.db
      .select({ bailId: etatsDesLieux.bailId, archivedAt: etatsDesLieux.archivedAt })
      .from(etatsDesLieux)
      .where(eq(etatsDesLieux.id, etatDesLieuxId))
      .limit(1);
    if (!entete) {
      throw new NotFoundException("État des lieux introuvable");
    }
    if (entete.archivedAt) {
      throw new ConflictException(MESSAGE_BROUILLON_ABANDONNE);
    }
    return entete;
  }

  private async verifierPhases(db: Pick<Database, "select">, etatDesLieuxId: string): Promise<void> {
    const phases = await resoudrePhasesSigneesEtatDesLieux(db, etatDesLieuxId);
    if (phases.sortieSignee) {
      throw new ConflictException(MESSAGE_SORTIE_SIGNEE);
    }
    if (phases.entreeSignee && phases.entreePapier === null) {
      throw new ConflictException(MESSAGE_ENTREE_SIGNEE_NUMERIQUEMENT);
    }
  }

  // Même règle que la signature numérique : au moins un locataire actif sur
  // le bail. Le papier peut ne porter que certains locataires, cochés parmi
  // les actifs ; le bailleur signe toujours, en premier.
  private async resoudreSignataires(
    bailId: string,
    bailleurNom: string,
    locataireIds: string[]
  ): Promise<SignataireEntreePapier[]> {
    const actifs = await this.db
      .select({ locataireId: bailLocataires.locataireId, nom: locataires.nom, prenom: locataires.prenom })
      .from(bailLocataires)
      .innerJoin(locataires, eq(locataires.id, bailLocataires.locataireId))
      .where(and(eq(bailLocataires.bailId, bailId), isNull(bailLocataires.archivedAt)));
    if (actifs.length === 0) {
      throw new BadRequestException("Au moins un locataire doit être rattaché au bail pour déclarer l'état des lieux.");
    }
    const coches = [...new Set(locataireIds)];
    if (coches.length === 0) {
      throw new BadRequestException("Au moins un locataire doit avoir signé l'état des lieux d'entrée papier.");
    }
    const parId = new Map(actifs.map((l) => [l.locataireId, `${l.prenom} ${l.nom}`]));
    const inconnus = coches.filter((id) => !parId.has(id));
    if (inconnus.length > 0) {
      throw new BadRequestException(`Signataire(s) non partie active à ce bail : ${inconnus.join(", ")}.`);
    }
    return [
      { role: "bailleur", locataireId: null, nomAffiche: bailleurNom },
      ...actifs
        .filter((l) => coches.includes(l.locataireId))
        .map((l) => ({ role: "locataire" as const, locataireId: l.locataireId, nomAffiche: parId.get(l.locataireId)! }))
    ];
  }

  // Décision 10 : les photos d'entrée prises dans l'application ne
  // correspondent pas au papier ; elles doivent être archivées avant la
  // déclaration. Une photo sans phase (antérieure au chantier signatures)
  // compte comme une photo d'entrée.
  private async verifierPhotosEntreeArchivees(etatDesLieuxId: string): Promise<void> {
    const photos = await this.db
      .select({ pieceType: documents.etatDesLieuxPieceType, pieceNumero: documents.etatDesLieuxPieceNumero })
      .from(documents)
      .where(
        and(
          eq(documents.entiteType, "etat_des_lieux"),
          eq(documents.entiteId, etatDesLieuxId),
          eq(documents.categorie, "photo"),
          isNull(documents.archivedAt),
          or(eq(documents.etatDesLieuxPhase, "entree"), isNull(documents.etatDesLieuxPhase))
        )
      );
    if (photos.length === 0) {
      return;
    }
    const pieces = [
      ...new Set(
        photos.map((p) => {
          const libelle = p.pieceType ? (LIBELLE_PIECE[p.pieceType] ?? p.pieceType) : "Sans pièce";
          return p.pieceNumero !== null ? `${libelle} ${p.pieceNumero}` : libelle;
        })
      )
    ].sort((a, b) => a.localeCompare(b, "fr"));
    throw new ConflictException(
      `Entrée papier refusée : ${photos.length} photo(s) d'entrée prise(s) dans l'application ne sont pas archivées (${pieces.join(", ")}). Archivez-les avant de déclarer l'entrée papier.`
    );
  }

  private traduireErreurBase(erreur: unknown): unknown {
    const code = codePostgres(erreur);
    if (code === CODE_POSTGRES_VIOLATION_EXCLUSION) {
      const message = erreur instanceof Error ? erreur.message : "";
      return new ConflictException(/sortie/.test(message) ? MESSAGE_SORTIE_SIGNEE : MESSAGE_ENTREE_SIGNEE_NUMERIQUEMENT);
    }
    if (code === CODE_POSTGRES_VIOLATION_UNICITE) {
      return new ConflictException("Une autre déclaration de l'entrée papier vient d'être enregistrée : rechargez puis réessayez.");
    }
    return erreur;
  }

  private async nettoyerBlobOrphelin(cheminStockage: string): Promise<void> {
    try {
      await this.storage.supprimer(cheminStockage);
    } catch (erreurNettoyage) {
      // Best-effort, comme pour les signatures : jamais masquer l'erreur
      // d'origine. Ce blob n'a jamais été rattaché à une ligne documents.
      this.logger.error(
        `Échec du nettoyage du scan orphelin ${cheminStockage} après transaction annulée`,
        erreurNettoyage instanceof Error ? erreurNettoyage.stack : String(erreurNettoyage)
      );
    }
  }
}
