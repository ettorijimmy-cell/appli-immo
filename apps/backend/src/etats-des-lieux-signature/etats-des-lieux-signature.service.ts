import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  appartements,
  bailLocataires,
  baux,
  bien,
  documents,
  etatDesLieuxSignature,
  etatsDesLieux,
  locataires,
  mettreAJourAvecAudit,
  type Database
} from "db";
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { dateDuJourParis } from "../common/date-paris";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { construireCheminStockage } from "../documents/storage/construire-chemin-stockage";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { OrganisationResolutionService } from "../organisation-resolution/organisation-resolution.service";
import { DocumentStorageService } from "../storage/document-storage.service";
import { decoderEtValiderImageSignature } from "./decoder-image-signature";
import type { SignerEtatDesLieuxDto } from "./dto/signer-etat-des-lieux.dto";

type Phase = "entree" | "sortie";
type Role = "bailleur" | "locataire";

interface SignataireResolu {
  role: Role;
  locataireId: string | null;
  nomAffiche: string;
  image: Buffer;
}

interface BlobEcrit {
  documentId: string;
  cheminStockage: string;
}

// Code d'erreur Postgres pour une violation de contrainte unique (voir
// etat_des_lieux_signature_bailleur_phase_unique/
// _locataire_phase_unique, packages/db/src/schema/etat-des-lieux-signature.ts)
// — filet de sécurité contre une course entre deux appels concurrents à
// signerEntree/signerSortie pour la même phase, au-delà de la vérification
// applicative faite avant la transaction (voir chargerContexte).
const CODE_POSTGRES_VIOLATION_UNICITE = "23505";

@Injectable()
export class EtatsDesLieuxSignatureService {
  private readonly logger = new Logger(EtatsDesLieuxSignatureService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storage: DocumentStorageService,
    private readonly requestContext: RequestContextService,
    private readonly etatsDesLieuxService: EtatsDesLieuxService,
    private readonly organisationResolution: OrganisationResolutionService
  ) {}

  async signerEntree(etatDesLieuxId: string, dto: SignerEtatDesLieuxDto) {
    return this.signerPhase(etatDesLieuxId, "entree", dto);
  }

  async signerSortie(etatDesLieuxId: string, dto: SignerEtatDesLieuxDto) {
    return this.signerPhase(etatDesLieuxId, "sortie", dto);
  }

  private async signerPhase(etatDesLieuxId: string, phase: Phase, dto: SignerEtatDesLieuxDto) {
    const contexte = await this.chargerContexte(etatDesLieuxId);

    const entreeDejaSignee = contexte.phasesSigneesParBailleur.has("entree");
    const sortieDejaSignee = contexte.phasesSigneesParBailleur.has("sortie");
    if (phase === "entree" && entreeDejaSignee) {
      throw new ConflictException("La partie entrée de cet état des lieux est déjà signée.");
    }
    if (phase === "sortie") {
      if (!entreeDejaSignee) {
        throw new ConflictException("L'entrée doit être signée avant de pouvoir signer la sortie.");
      }
      if (sortieDejaSignee) {
        throw new ConflictException("Cet état des lieux est déjà intégralement signé.");
      }
    }

    if (!dto.bailleur.luEtApprouve) {
      throw new BadRequestException("La case « Lu et approuvé » doit être cochée pour le bailleur.");
    }

    const nomBailleur = dto.bailleur.nomAffiche.trim();
    if (!nomBailleur) {
      throw new BadRequestException("Le nom du bailleur ne peut pas être vide.");
    }

    // Un état des lieux sans aucun locataire actif est contradictoire
    // (il n'y a personne pour emménager/quitter le logement) — jamais
    // signable, quelle que soit la phase.
    if (contexte.locatairesActifs.length === 0) {
      throw new BadRequestException("Au moins un locataire doit être rattaché au bail pour signer l'état des lieux.");
    }

    // Correspondance exacte avec les bail_locataires actifs au moment de
    // la signature — ni manquant, ni en trop (voir docs/data-dictionary.md,
    // section etat_des_lieux_signature, "Signataires locataires résolus
    // en direct").
    const idsAttendus = new Set(contexte.locatairesActifs.map((l) => l.locataireId));
    const idsRecus = new Set(dto.locataires.map((s) => s.locataireId));
    const manquants = contexte.locatairesActifs.filter((l) => !idsRecus.has(l.locataireId));
    const inattendus = [...idsRecus].filter((id) => !idsAttendus.has(id));
    if (manquants.length > 0) {
      throw new BadRequestException(
        `Signature manquante pour : ${manquants.map((l) => l.nomAffiche).join(", ")}.`
      );
    }
    if (inattendus.length > 0) {
      throw new BadRequestException(
        `Signataire(s) non partie active à ce bail : ${inattendus.join(", ")}.`
      );
    }
    for (const signataire of dto.locataires) {
      if (!signataire.luEtApprouve) {
        const nom = contexte.locatairesActifs.find((l) => l.locataireId === signataire.locataireId)?.nomAffiche;
        throw new BadRequestException(`La case « Lu et approuvé » doit être cochée pour ${nom ?? signataire.locataireId}.`);
      }
    }

    const lieu = dto.lieu?.trim() || contexte.villeLogement;

    const signataires: SignataireResolu[] = [
      {
        role: "bailleur",
        locataireId: null,
        nomAffiche: nomBailleur,
        image: decoderEtValiderImageSignature(dto.bailleur.imagePng, "le bailleur")
      },
      ...dto.locataires.map((s) => {
        const locataire = contexte.locatairesActifs.find((l) => l.locataireId === s.locataireId);
        // Impossible à ce stade (idsRecus === idsAttendus déjà vérifié
        // ci-dessus) — seulement pour satisfaire le typage.
        if (!locataire) {
          throw new BadRequestException(`Signataire ${s.locataireId} introuvable.`);
        }
        return {
          role: "locataire" as const,
          locataireId: s.locataireId,
          nomAffiche: locataire.nomAffiche,
          image: decoderEtValiderImageSignature(s.imagePng, locataire.nomAffiche)
        };
      })
    ];

    // Blobs écrits AVANT la transaction SQL (même convention que
    // DocumentsService.creerDepuisBuffer : le stockage n'est de toute
    // façon jamais couvert par une transaction Postgres). Si la
    // transaction échoue ensuite, nettoyerBlobsOrphelins supprime tout ce
    // qui a déjà été écrit — ces blobs n'ont jamais été rattachés à une
    // ligne `documents`, ce ne sont jamais des "documents" au sens métier
    // (CLAUDE.md, aucune suppression définitive de document).
    const blobsEcrits: BlobEcrit[] = [];
    try {
      for (const signataire of signataires) {
        const documentId = uuidv7();
        const cheminStockage = construireCheminStockage("etat_des_lieux", etatDesLieuxId, documentId);
        await this.storage.enregistrer(signataire.image, cheminStockage);
        blobsEcrits.push({ documentId, cheminStockage });
      }

      const utilisateurId = this.requestContext.getUtilisateurId();
      // Date de Paris, pas UTC (CLAUDE.md implicite : une signature posée
      // entre 22h et minuit UTC en hiver, ou 21h/22h en été, doit porter
      // la date réellement vécue à Paris par les signataires — jamais
      // celle, potentiellement déjà la veille ou le lendemain, de
      // Greenwich).
      const aujourdHui = dateDuJourParis();

      await this.db.transaction(async (tx) => {
        for (let i = 0; i < signataires.length; i++) {
          const signataire = signataires[i]!;
          const blob = blobsEcrits[i]!;
          await tx.insert(documents).values({
            id: blob.documentId,
            entiteType: "etat_des_lieux",
            entiteId: etatDesLieuxId,
            categorie: "signature",
            nomFichier: `signature-${signataire.role}-${phase}.png`,
            mimeType: "image/png",
            tailleOctets: signataire.image.byteLength,
            cheminStockage: blob.cheminStockage,
            etatDesLieuxPhase: phase
          });
          await tx.insert(etatDesLieuxSignature).values({
            etatDesLieuxId,
            phase,
            role: signataire.role,
            locataireId: signataire.locataireId,
            nomAffiche: signataire.nomAffiche,
            documentId: blob.documentId,
            luEtApprouve: true,
            signeLe: new Date()
          });
        }
        // dateEntree/dateSortie posée dans la même transaction que les
        // signatures — jamais l'une sans les autres (exigence explicite).
        await mettreAJourAvecAudit(
          tx,
          etatsDesLieux,
          etatDesLieuxId,
          phase === "entree" ? { dateEntree: aujourdHui, lieuEntree: lieu } : { dateSortie: aujourdHui, lieuSortie: lieu },
          utilisateurId
        );
      });
    } catch (erreur) {
      await this.nettoyerBlobsOrphelins(blobsEcrits);
      if (this.estViolationUnicite(erreur)) {
        throw new ConflictException(
          phase === "entree"
            ? "La partie entrée de cet état des lieux est déjà signée."
            : "Cet état des lieux est déjà intégralement signé."
        );
      }
      throw erreur;
    }

    return this.etatsDesLieuxService.findById(etatDesLieuxId);
  }

  private async nettoyerBlobsOrphelins(blobs: BlobEcrit[]): Promise<void> {
    for (const blob of blobs) {
      try {
        await this.storage.supprimer(blob.cheminStockage);
      } catch (erreurNettoyage) {
        // Best-effort : un échec de nettoyage ne doit jamais masquer
        // l'erreur d'origine (déjà relancée par l'appelant) — seulement
        // journalisé, pour une purge manuelle ultérieure si besoin.
        this.logger.error(
          `Échec du nettoyage du blob orphelin ${blob.cheminStockage} après transaction annulée`,
          erreurNettoyage instanceof Error ? erreurNettoyage.stack : String(erreurNettoyage)
        );
      }
    }
  }

  private estViolationUnicite(erreur: unknown): boolean {
    return (
      typeof erreur === "object" &&
      erreur !== null &&
      "code" in erreur &&
      (erreur as { code: unknown }).code === CODE_POSTGRES_VIOLATION_UNICITE
    );
  }

  private async chargerContexte(etatDesLieuxId: string) {
    const [entete] = await this.db.select().from(etatsDesLieux).where(eq(etatsDesLieux.id, etatDesLieuxId)).limit(1);
    if (!entete) {
      throw new NotFoundException("État des lieux introuvable");
    }

    // Refuse en cas de doute plutôt que d'accorder l'accès — décision
    // explicite pour ce service précisément parce qu'une signature est un
    // acte à valeur légale, contrairement au reste du code existant
    // (EtatsDesLieuxService.verifierAppartenance, DocumentsService
    // .verifierEntiteExiste) qui tolère une absence d'organisationId
    // (scripts/tests hors contexte HTTP) en ignorant simplement le
    // contrôle. Ici, l'absence de contexte organisation est un refus, pas
    // un passe-droit. Réutilise OrganisationResolutionService comme les
    // autres services scopés (même méthode que DocumentsService pour
    // entiteType='etat_des_lieux'), plutôt qu'une jointure ad hoc.
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      throw new NotFoundException("État des lieux introuvable");
    }
    const idsValides = await this.organisationResolution.resoudreEntiteIdsOrganisation("etat_des_lieux", organisationId);
    if (!idsValides.includes(etatDesLieuxId)) {
      throw new NotFoundException("État des lieux introuvable");
    }

    const [jointure] = await this.db
      .select({ ville: bien.ville })
      .from(baux)
      .innerJoin(appartements, eq(appartements.id, baux.appartementId))
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(eq(baux.id, entete.bailId))
      .limit(1);
    if (!jointure) {
      throw new NotFoundException("État des lieux introuvable");
    }

    const liensLocataires = await this.db
      .select({ locataireId: bailLocataires.locataireId, nom: locataires.nom, prenom: locataires.prenom })
      .from(bailLocataires)
      .innerJoin(locataires, eq(locataires.id, bailLocataires.locataireId))
      .where(and(eq(bailLocataires.bailId, entete.bailId), isNull(bailLocataires.archivedAt)));

    const signaturesBailleur = await this.db
      .select({ phase: etatDesLieuxSignature.phase })
      .from(etatDesLieuxSignature)
      .where(
        and(
          eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId),
          eq(etatDesLieuxSignature.role, "bailleur"),
          isNull(etatDesLieuxSignature.archivedAt)
        )
      );

    return {
      villeLogement: jointure.ville,
      locatairesActifs: liensLocataires.map((l) => ({ locataireId: l.locataireId, nomAffiche: `${l.prenom} ${l.nom}` })),
      phasesSigneesParBailleur: new Set(signaturesBailleur.map((s) => s.phase))
    };
  }
}
