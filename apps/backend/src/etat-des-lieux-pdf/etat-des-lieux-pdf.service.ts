import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown
} from "@nestjs/common";
import { documents, etatDesLieuxSignature, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { DocumentsService } from "../documents/documents.service";
import { construireCheminStockage } from "../documents/storage/construire-chemin-stockage";
import { EtatDesLieuxDocumentDocxService } from "../etat-des-lieux-document-docx/etat-des-lieux-document-docx.service";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { GotenbergIndisponibleError } from "../gotenberg/gotenberg.errors";
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
  // Chaînes en cours (produireDocumentsFigesEnArrierePlan OU
  // rattraperDocumentsManquantsEnArrierePlan), indexées par (état des
  // lieux, phase) — jamais un simple Set : une Map permet à un second
  // déclencheur pour le MÊME couple (signature, job planifié, relance à
  // la lecture, endpoint manuel) de rejoindre la tâche déjà en cours
  // plutôt que d'en lancer une seconde en parallèle (voir
  // obtenirOuLancerTache ci-dessous). Alimentée à l'ajout, retirée dans un
  // `finally`, jamais par un .catch() seul (une chaîne ne rejette jamais,
  // mais le retrait doit survenir dans tous les cas, succès compris).
  // Permet aussi d'attendre déterministiquement leur fin (tests, et
  // onApplicationShutdown ci-dessous) plutôt qu'un délai fixe arbitraire.
  private readonly tachesEnCours = new Map<string, Promise<void>>();

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

  // Clé de dédoublonnage dans tachesEnCours — un seul format, utilisé par
  // obtenirOuLancerTache ci-dessous et relu directement par
  // produireManuellement (voir plus bas) pour rejoindre une chaîne en
  // cours sans en relire le contenu.
  private cleTache(etatDesLieuxId: string, phase: PhaseEtatDesLieux): string {
    return `${etatDesLieuxId}:${phase}`;
  }

  // Dédoublonnage central : si une chaîne est DÉJÀ en cours pour ce
  // couple (état des lieux, phase) — peu importe laquelle des deux
  // méthodes l'a lancée, produireDocumentsFigesEnArrierePlan ou
  // rattraperDocumentsManquantsEnArrierePlan ci-dessous, les deux
  // partagent la MÊME Map — la rejoint telle quelle au lieu d'en lancer
  // une seconde en parallèle (même document cible, même appel Gotenberg
  // potentiel). Sans ça, un job planifié qui se déclenche pendant que la
  // chaîne de signature tourne encore, ou une relance à la lecture juste
  // après un clic sur le bouton manuel, dupliqueraient le travail (et,
  // pour le .docx, retenteraient une insertion déjà satisfaite — voir
  // docs/error-log.md, [2026-10-30]).
  private obtenirOuLancerTache(
    etatDesLieuxId: string,
    phase: PhaseEtatDesLieux,
    executer: () => Promise<void>
  ): Promise<void> {
    const cle = this.cleTache(etatDesLieuxId, phase);
    const tacheExistante = this.tachesEnCours.get(cle);
    if (tacheExistante) {
      return tacheExistante;
    }
    const tache = executer();
    this.tachesEnCours.set(cle, tache);
    void tache.finally(() => {
      // Ne retire que si c'est toujours CETTE tâche à cette clé — filet
      // de rigueur, improbable en pratique (le retrait est synchrone dès
      // qu'une tâche se termine, rien ne peut en reposer une autre à la
      // même clé avant ce retrait).
      if (this.tachesEnCours.get(cle) === tache) {
        this.tachesEnCours.delete(cle);
      }
    });
    return tache;
  }

  // GotenbergIndisponibleError couvre deux cas bien différents (voir
  // gotenberg.service.ts) : non configuré (GOTENBERG_URL absente) et
  // transitoire (réseau, délai, 502-504) sur une instance configurée.
  // GotenbergService journalise déjà un WARN une seule fois, au
  // démarrage, si Gotenberg n'est pas configuré — jamais la peine de le
  // répéter à chaque passage du job (toutes les 10 minutes, potentiellement
  // pendant des semaines avant un déploiement Gotenberg) : estConfigure()
  // permet de distinguer ce cas-là, silencieux ici. Un échec transitoire,
  // lui, reste digne d'un WARN à chaque occurrence (signal utile,
  // attendu, qui se résout seul à la prochaine relance). Tout le reste
  // (GotenbergConversionError, ou toute erreur inattendue) reste en
  // ERROR, visible dans Cockpit, avec l'id de l'état des lieux et la
  // phase — jamais de secret (identifiants, en-tête Authorization — déjà
  // garanti par GotenbergService), seulement le nom de la classe d'erreur
  // et son message.
  private journaliserEchecPdf(etatDesLieuxId: string, phase: PhaseEtatDesLieux, erreur: unknown): void {
    if (erreur instanceof GotenbergIndisponibleError) {
      if (this.gotenbergService.estConfigure()) {
        this.logger.warn(
          `Gotenberg temporairement indisponible pour la conversion PDF (${phase}), état des lieux ${etatDesLieuxId} : ${erreur.message}`
        );
      }
      return;
    }
    this.logger.error(
      `Échec de la conversion PDF (${phase}) pour l'état des lieux ${etatDesLieuxId} : ` +
        (erreur instanceof Error ? `${erreur.constructor.name} — ${erreur.message}` : String(erreur))
    );
  }

  // Seule méthode appelée par EtatsDesLieuxSignatureService, juste après
  // le commit de la signature — EN ARRIÈRE-PLAN (jamais attendue par la
  // réponse de signature, voir son appelant), UNE SEULE chaîne couvrant
  // le .docx PUIS le PDF, jamais deux promesses indépendantes. Ne rejette
  // JAMAIS (chaque étape est son propre try/catch) : sûre à appeler sans
  // await, sans risque de promesse rejetée non gérée — vérifié par test
  // dédié. Si le .docx échoue, le PDF n'est même pas tenté (rien à
  // convertir) ; si le .docx réussit (ou existe déjà, no-op de l'index
  // unique) mais que le PDF échoue, l'échec reste local au PDF.
  //
  // Dédoublonnée via obtenirOuLancerTache (voir ci-dessus) : un second
  // appel pour le même couple, pendant que la chaîne tourne encore,
  // rejoint la même promesse plutôt que d'en lancer une nouvelle. Renvoie
  // la promesse (pas `void`) : un appelant qui veut l'attendre
  // explicitement le peut toujours (tests, endpoint manuel via
  // produireManuellement, qui rejoint une chaîne en cours avant ses
  // propres vérifications).
  produireDocumentsFigesEnArrierePlan(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<void> {
    return this.obtenirOuLancerTache(etatDesLieuxId, phase, () => this.executerChaineDocumentsFiges(etatDesLieuxId, phase));
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
      this.journaliserEchecPdf(etatDesLieuxId, phase, erreur);
    }
  }

  // Rattrapage (job planifié, relance à la lecture — jamais la première
  // tentative juste après signature, voir produireDocumentsFigesEnArrierePlan
  // ci-dessus) : vérifie la présence de chaque document AVANT de le
  // produire, jamais une tentative inconditionnelle. Différence cruciale
  // avec la chaîne ci-dessus, qui elle n'a JAMAIS besoin de vérifier (rien
  // n'existe encore à ce stade) et s'appuie uniquement sur l'index unique
  // comme filet. Ici, le document existe très souvent déjà (c'est le cas
  // normal : seul l'un des deux manque) — retenter l'insertion dans ce cas
  // provoquerait systématiquement une violation de contrainte unique, ce
  // qui est sans risque en production (chaque requête a sa propre
  // transaction implicite) mais s'est révélé casser la transaction
  // explicite partagée des tests d'intégration (toute requête suivante
  // dans la MÊME transaction échoue ensuite avec "current transaction is
  // aborted") — découvert en écrivant les tests de ce rattrapage, voir
  // docs/error-log.md, [2026-10-30]. Même structure (deux étapes, chacune
  // son propre try/catch, jamais de rejet) et dédoublonnée par la MÊME
  // Map que la chaîne ci-dessus (voir obtenirOuLancerTache) : un job qui
  // se déclenche pendant qu'une chaîne de signature tourne encore pour le
  // même couple la rejoint, jamais une seconde chaîne en parallèle.
  rattraperDocumentsManquantsEnArrierePlan(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<void> {
    return this.obtenirOuLancerTache(etatDesLieuxId, phase, () => this.executerRattrapage(etatDesLieuxId, phase));
  }

  private async executerRattrapage(etatDesLieuxId: string, phase: PhaseEtatDesLieux): Promise<void> {
    if (!(await this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_docx"))) {
      try {
        await this.assurerDocxFige(etatDesLieuxId, phase);
      } catch (erreur) {
        this.logger.error(
          `Échec du rattrapage du .docx figé (${phase}) pour l'état des lieux ${etatDesLieuxId}`,
          erreur instanceof Error ? erreur.stack : String(erreur)
        );
        return;
      }
    }
    if (!(await this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_pdf"))) {
      try {
        await this.assurerPdfFige(etatDesLieuxId, phase);
      } catch (erreur) {
        this.journaliserEchecPdf(etatDesLieuxId, phase, erreur);
      }
    }
  }

  // Attente déterministe (tests, et base de onApplicationShutdown
  // ci-dessous) — jamais un délai fixe arbitraire. allSettled plutôt que
  // all : chaque tâche suivie ne rejette déjà jamais (voir
  // executerChaineDocumentsFiges), mais allSettled reste la forme
  // correcte pour "attendre que tout soit fini", succès ou non.
  async attendreTachesEnCours(): Promise<void> {
    await Promise.allSettled([...this.tachesEnCours.values()]);
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

    // Si une chaîne est déjà en cours pour ce couple (signature, job
    // planifié ou relance à la lecture), la rejoint plutôt que de lancer
    // sa propre tentative concurrente — même document cible, même appel
    // Gotenberg potentiel (voir obtenirOuLancerTache). Cette chaîne
    // rejointe avale ses propres erreurs (voir son commentaire) : les
    // vérifications ci-dessous, après l'avoir attendue, décident donc
    // seules du résultat réellement renvoyé à cet appel.
    const tacheExistante = this.tachesEnCours.get(this.cleTache(etatDesLieuxId, phase));
    if (tacheExistante) {
      await tacheExistante;
    }

    // Produit ce qui manque encore, propage toute erreur (endpoint
    // manuel — contrairement à la chaîne en arrière-plan ci-dessus, un
    // échec ici doit remonter comme une erreur HTTP, jamais être avalé,
    // même si la chaîne rejointe au-dessus a déjà tenté et échoué).
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
  //
  // Relance à la lecture (chantier PDF étape 4) : toute phase signée mais
  // dont le .docx et/ou le PDF figé manque encore déclenche ici un
  // rattrapage en arrière-plan, jamais attendu par cette lecture — simple
  // filet supplémentaire, redondant avec la relance planifiée
  // (EtatDesLieuxPdfJobService) et protégé de la même façon contre tout
  // doublon par l'index unique partiel (une course entre les deux, ou
  // avec le bouton manuel, se résout toujours en no-op silencieux).
  async listerDocumentsFiges(etatDesLieuxId: string): Promise<StatutDocumentsFigesPhase[]> {
    await this.verifierAppartenanceFailClosed(etatDesLieuxId);
    const etatDesLieux = await this.etatsDesLieuxService.findById(etatDesLieuxId);
    const phases: PhaseEtatDesLieux[] = ["entree", "sortie"];
    const resultats = await Promise.all(
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
    for (const resultat of resultats) {
      const phaseSignee =
        resultat.phase === "entree" ? etatDesLieux.entreeSigneeParTous : etatDesLieux.sortieSigneeParTous;
      if (phaseSignee && (!resultat.docx || !resultat.pdf)) {
        this.rattraperDocumentsManquantsEnArrierePlan(etatDesLieuxId, resultat.phase);
      }
    }
    return resultats;
  }

  // Rattrapage système (EtatDesLieuxPdfJobService, relance planifiée) :
  // balaie TOUTES les signatures bailleur, toutes organisations
  // confondues — ce job n'a pas de contexte HTTP/organisation, à la
  // différence de produireManuellement/listerDocumentsFiges ci-dessus,
  // donc aucun verifierAppartenanceFailClosed ici. Même source de vérité
  // "phase signée" que resoudrePhasesSigneesEtatDesLieux (une signature
  // bailleur, archived_at NULL) — relue ici directement en masse plutôt
  // que phase par phase. Volume très faible (quelques états des lieux
  // signés par an) : un aller-retour par couple (état des lieux, phase)
  // pour vérifier la présence du .docx et du PDF est largement
  // suffisant, pas la peine d'une requête SQL à deux NOT EXISTS pour ce
  // volume.
  async trouverPhasesSigneesIncompletes(): Promise<{ etatDesLieuxId: string; phase: PhaseEtatDesLieux }[]> {
    const signaturesBailleur = await this.db
      .selectDistinct({
        etatDesLieuxId: etatDesLieuxSignature.etatDesLieuxId,
        phase: etatDesLieuxSignature.phase
      })
      .from(etatDesLieuxSignature)
      .where(and(eq(etatDesLieuxSignature.role, "bailleur"), isNull(etatDesLieuxSignature.archivedAt)));

    const incomplets: { etatDesLieuxId: string; phase: PhaseEtatDesLieux }[] = [];
    for (const { etatDesLieuxId, phase } of signaturesBailleur) {
      const [docx, pdf] = await Promise.all([
        this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_docx"),
        this.trouverDocumentFige(etatDesLieuxId, phase, "etat_des_lieux_pdf")
      ]);
      if (!docx || !pdf) {
        incomplets.push({ etatDesLieuxId, phase });
      }
    }
    return incomplets;
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
