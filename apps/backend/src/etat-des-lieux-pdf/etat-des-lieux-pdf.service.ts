import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown
} from "@nestjs/common";
import { documents, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { DocumentsService } from "../documents/documents.service";
import { construireCheminStockage } from "../documents/storage/construire-chemin-stockage";
import { EtatDesLieuxDocumentDocxService } from "../etat-des-lieux-document-docx/etat-des-lieux-document-docx.service";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { GotenbergService } from "../gotenberg/gotenberg.service";
import { OrganisationResolutionService } from "../organisation-resolution/organisation-resolution.service";
import { DocumentStorageService } from "../storage/document-storage.service";

export type PhaseEtatDesLieux = "entree" | "sortie";

export interface StatutDocumentsFigesPhase {
  phase: PhaseEtatDesLieux;
  docx: { documentId: string; createdAt: Date } | null;
  pdf: { documentId: string; createdAt: Date } | null;
}

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_PDF = "application/pdf";

// Code d'erreur Postgres pour une violation de contrainte unique — même
// convention que EtatsDesLieuxSignatureService (CODE_POSTGRES_VIOLATION_
// UNICITE), dupliqué localement plutôt qu'un util partagé (voir aussi
// taches-job.service.ts/baux.service.ts, aucun des trois ne s'y réfère
// mutuellement). Ici, filet contre la course entre génération immédiate
// (après signature), relance, et bouton manuel pour la même (entité,
// catégorie, phase) — voir l'index unique partiel documents_etat_des_
// lieux_fige_unique, packages/db/src/schema/documents.ts.
const CODE_POSTGRES_VIOLATION_UNICITE = "23505";

// Production et lecture des documents FIGÉS de l'état des lieux (.docx
// juste après signature, PDF converti à partir de ce .docx — chantier
// PDF étape 4, 2026-10-27). Jamais régénérés une fois produits pour une
// phase : voir l'index unique partiel qui tranche toute course entre
// génération immédiate, relance (job à venir) et bouton manuel.
// Plafond d'attente à l'arrêt de l'application (onApplicationShutdown) —
// jamais bloquer indéfiniment un arrêt/redéploiement pour une chaîne en
// cours : au-delà, elle est simplement coupée, et c'est à la relance (job
// planifié, chantier PDF à venir) de la rattraper, exactement comme un
// échec Gotenberg ordinaire.
const PLAFOND_ATTENTE_ARRET_MS = 5000;

@Injectable()
export class EtatDesLieuxPdfService implements OnApplicationShutdown {
  private readonly logger = new Logger(EtatDesLieuxPdfService.name);
  // Chaînes produireDocumentsFigesEnArrierePlan en cours — alimenté à
  // l'ajout, retiré dans un `finally`, jamais par un .catch() seul (la
  // chaîne ne rejette jamais, mais le retrait doit survenir dans tous les
  // cas, succès compris). Permet d'attendre déterministiquement leur fin
  // (tests, et onApplicationShutdown ci-dessous) plutôt qu'un délai fixe
  // arbitraire.
  private readonly tachesEnCours = new Set<Promise<void>>();

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly storage: DocumentStorageService,
    private readonly requestContext: RequestContextService,
    private readonly organisationResolution: OrganisationResolutionService,
    private readonly etatsDesLieuxService: EtatsDesLieuxService,
    private readonly etatDesLieuxDocumentDocxService: EtatDesLieuxDocumentDocxService,
    private readonly documentsService: DocumentsService,
    private readonly gotenbergService: GotenbergService
  ) {}

  // Fail-closed, jamais un skip silencieux si le contexte organisation est
  // absent — même principe que EtatsDesLieuxSignatureService.
  // chargerContexte : ces documents ont la même valeur légale qu'une
  // signature, contrairement au reste de l'application qui tolère
  // l'absence de contexte HTTP (scripts/tests).
  private async verifierAppartenanceFailClosed(etatDesLieuxId: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      throw new NotFoundException("État des lieux introuvable");
    }
    const idsValides = await this.organisationResolution.resoudreEntiteIdsOrganisation(
      "etat_des_lieux",
      organisationId
    );
    if (!idsValides.includes(etatDesLieuxId)) {
      throw new NotFoundException("État des lieux introuvable");
    }
  }

  private async trouverDocumentFige(
    etatDesLieuxId: string,
    phase: PhaseEtatDesLieux,
    categorie: "etat_des_lieux_docx" | "etat_des_lieux_pdf"
  ) {
    const [ligne] = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.entiteType, "etat_des_lieux"),
          eq(documents.entiteId, etatDesLieuxId),
          eq(documents.categorie, categorie),
          eq(documents.etatDesLieuxPhase, phase),
          isNull(documents.archivedAt)
        )
      )
      .limit(1);
    return ligne ?? null;
  }

  // Brique de base, appelée par produireDocumentsFigesEnArrierePlan()
  // ci-dessous (après signature) et par produireManuellement(). Toujours
  // en mode "phase" explicite (jamais l'état courant) : voir
  // EtatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx,
  // paramètre phaseFigee.
  //
  // Limite acceptée : si cette génération est produite TARDIVEMENT (la
  // tentative immédiate après signature a échoué, et c'est la relance ou
  // le bouton manuel qui la rattrape plus tard), elle relit les données
  // du bail/bien/bailleur telles qu'elles sont AU MOMENT de cette
  // génération tardive, pas telles qu'elles étaient au moment de la
  // signature — seuls les champs verrouillés par la signature de cette
  // phase (classification-champs-etat-des-lieux.ts) sont garantis
  // inchangés entre les deux instants ; un nom de bailleur ou une adresse
  // modifiée dans l'intervalle apparaîtrait mise à jour. Décision actée :
  // la fenêtre entre signature et génération réussie est censée rester
  // courte (secondes à minutes), ce risque est jugé acceptable plutôt que
  // de figer une copie complète de toutes les données au moment de la
  // signature.
  async assurerDocxFige(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<void> {
    const buffer = await this.etatDesLieuxDocumentDocxService.genererDocumentEtatDesLieuxDocx(etatDesLieuxId, phase);
    await this.stockerDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_docx", buffer, `etat-des-lieux-${phase}.docx`, MIME_DOCX);
  }

  // Suppose que le .docx figé existe déjà (assurerDocxFige) — lève
  // NotFoundException sinon, jamais de génération implicite ici : ce
  // n'est pas la responsabilité de cette méthode (voir produireManuellement
  // pour l'enchaînement complet).
  async assurerPdfFige(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<void> {
    const docx = await this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_docx");
    if (!docx) {
      throw new NotFoundException(`Aucun .docx figé (${phase}) à convertir pour cet état des lieux.`);
    }
    // DocumentsService.telecharger() : seul point de déchiffrement
    // (CLAUDE.md), journalise déjà l'accès dans journal_audit.
    const { contenu } = await this.documentsService.telecharger(docx.id);
    const pdf = await this.gotenbergService.convertirDocxEnPdf(contenu, `etat-des-lieux-${phase}.docx`);
    await this.stockerDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_pdf", pdf, `etat-des-lieux-${phase}.pdf`, MIME_PDF);
  }

  // Seule méthode appelée par EtatsDesLieuxSignatureService, juste après
  // le commit de la signature — EN ARRIÈRE-PLAN (jamais attendue par la
  // réponse de signature, voir son appelant), UNE SEULE chaîne couvrant
  // le .docx PUIS le PDF, jamais deux promesses indépendantes. Ne rejette
  // JAMAIS (chaque étape est son propre try/catch) : sûre à appeler sans
  // await, sans risque de promesse rejetée non gérée — vérifié par test
  // dédié. Si le .docx échoue, le PDF n'est même pas tenté (rien à
  // convertir) ; si le .docx réussit (ou existe déjà, no-op de l'index
  // unique) mais que le PDF échoue, l'échec reste local au PDF. Chaque
  // étape journalise sa propre erreur, jamais de secret (identifiants,
  // en-tête Authorization — déjà garanti par GotenbergService) : le nom
  // de la classe d'erreur et son message, rien de plus.
  //
  // Enregistrée dans tachesEnCours dès son lancement (jamais à l'intérieur
  // d'executerChaineDocumentsFiges, qui ne connaît pas encore sa propre
  // promesse) — retirée dans un `finally`, que la chaîne ait réussi ou
  // échoué. Renvoie la promesse (pas `void`) : un appelant qui veut
  // l'attendre explicitement le peut toujours (tests, endpoint manuel
  // via produireManuellement qui appelle les étapes directement).
  produireDocumentsFigesEnArrierePlan(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<void> {
    const tache = this.executerChaineDocumentsFiges(etatDesLieuxId, phase);
    this.tachesEnCours.add(tache);
    void tache.finally(() => this.tachesEnCours.delete(tache));
    return tache;
  }

  private async executerChaineDocumentsFiges(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<void> {
    try {
      await this.assurerDocxFige(etatDesLieuxId, phase);
    } catch (erreur) {
      this.logger.error(
        `Échec de la génération du .docx figé (${phase}) pour l'état des lieux ${etatDesLieuxId}`,
        erreur instanceof Error ? erreur.stack : String(erreur)
      );
      return;
    }
    try {
      await this.assurerPdfFige(etatDesLieuxId, phase);
    } catch (erreur) {
      this.logger.error(
        `Échec de la conversion PDF (${phase}) pour l'état des lieux ${etatDesLieuxId} : ` +
          (erreur instanceof Error ? `${erreur.constructor.name} — ${erreur.message}` : String(erreur))
      );
    }
  }

  // Attente déterministe (tests, et base de onApplicationShutdown
  // ci-dessous) — jamais un délai fixe arbitraire. allSettled plutôt que
  // all : chaque tâche suivie ne rejette déjà jamais (voir
  // executerChaineDocumentsFiges), mais allSettled reste la forme
  // correcte pour "attendre que tout soit fini", succès ou non.
  async attendreTachesEnCours(): Promise<void> {
    await Promise.allSettled([...this.tachesEnCours]);
  }

  // Arrêt de l'application (redéploiement, restart) : laisse les chaînes
  // en cours se terminer, mais jamais indéfiniment — au-delà du plafond,
  // l'arrêt se poursuit et la ou les chaînes encore en vol sont coupées.
  // Pas une perte silencieuse : la relance (job planifié, chantier PDF à
  // venir) retentera cette phase comme n'importe quel échec Gotenberg
  // ordinaire (document absent constaté, jamais un état à moitié écrit —
  // l'index unique partiel protège déjà contre ça).
  async onApplicationShutdown(): Promise<void> {
    await Promise.race([
      this.attendreTachesEnCours(),
      new Promise<void>((resolve) => setTimeout(resolve, PLAFOND_ATTENTE_ARRET_MS))
    ]);
  }

  // Écrit directement dans `documents` (jamais via DocumentsService.
  // creerDepuisBuffer, qui refuse ces deux catégories — réservées à ce
  // service, même principe que EtatsDesLieuxSignatureService pour
  // "signature"). La violation de l'index unique partiel est avalée en
  // silence : une course gagnée par un autre appel (génération immédiate,
  // relance, bouton) n'est jamais une erreur, jamais un écrasement.
  private async stockerDocumentFige(
    etatDesLieuxId: string,
    phase: PhaseEtatDesLieux,
    categorie: "etat_des_lieux_docx" | "etat_des_lieux_pdf",
    contenu: Buffer,
    nomFichier: string,
    mimeType: string
  ): Promise<void> {
    const documentId = uuidv7();
    const cheminStockage = construireCheminStockage("etat_des_lieux", etatDesLieuxId, documentId);
    await this.storage.enregistrer(contenu, cheminStockage);
    try {
      await this.db.insert(documents).values({
        id: documentId,
        entiteType: "etat_des_lieux",
        entiteId: etatDesLieuxId,
        categorie,
        nomFichier,
        mimeType,
        tailleOctets: contenu.byteLength,
        cheminStockage,
        etatDesLieuxPhase: phase,
        estEtatDesLieuxFige: true
      });
    } catch (erreur) {
      await this.storage.supprimer(cheminStockage).catch((erreurNettoyage) => {
        this.logger.error(
          `Échec du nettoyage du blob orphelin ${cheminStockage} après conflit d'insertion`,
          erreurNettoyage instanceof Error ? erreurNettoyage.stack : String(erreurNettoyage)
        );
      });
      if (this.estViolationUnicite(erreur)) {
        return;
      }
      throw erreur;
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

  // Endpoint manuel (bouton "Produire le PDF") : refuse si la phase n'est
  // pas signée, puis ne produit que ce qui manque — idempotent, jamais de
  // régénération si le document figé existe déjà pour cette phase.
  async produireManuellement(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<void> {
    await this.verifierAppartenanceFailClosed(etatDesLieuxId);
    const etatDesLieux = await this.etatsDesLieuxService.findById(etatDesLieuxId);
    if (!etatDesLieux) {
      throw new NotFoundException("État des lieux introuvable");
    }
    const phaseSignee = phase === "entree" ? etatDesLieux.entreeSigneeParTous : etatDesLieux.sortieSigneeParTous;
    if (!phaseSignee) {
      throw new ConflictException(`La phase '${phase}' de cet état des lieux n'est pas signée.`);
    }

    const docxExistant = await this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_docx");
    if (!docxExistant) {
      await this.assurerDocxFige(etatDesLieuxId, phase);
    }
    const pdfExistant = await this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_pdf");
    if (!pdfExistant) {
      await this.assurerPdfFige(etatDesLieuxId, phase);
    }
  }

  // Lecture (chaque phase, présence/absence de chaque catégorie figée) —
  // même contrôle d'organisation fail-closed que produireManuellement.
  async listerDocumentsFiges(etatDesLieuxId: string): Promise<StatutDocumentsFigesPhase[]> {
    await this.verifierAppartenanceFailClosed(etatDesLieuxId);
    const phases: PhaseEtatDesLieux[] = ["entree", "sortie"];
    return Promise.all(
      phases.map(async (phase) => {
        const [docx, pdf] = await Promise.all([
          this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_docx"),
          this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_pdf")
        ]);
        return {
          phase,
          docx: docx ? { documentId: docx.id, createdAt: docx.createdAt } : null,
          pdf: pdf ? { documentId: pdf.id, createdAt: pdf.createdAt } : null
        };
      })
    );
  }

  async telechargerPdf(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<{ contenu: Buffer; nomFichier: string }> {
    await this.verifierAppartenanceFailClosed(etatDesLieuxId);
    const pdf = await this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_pdf");
    if (!pdf) {
      throw new NotFoundException(`Aucun PDF (${phase}) disponible pour cet état des lieux.`);
    }
    const { contenu } = await this.documentsService.telecharger(pdf.id);
    return { contenu, nomFichier: pdf.nomFichier };
  }
}
