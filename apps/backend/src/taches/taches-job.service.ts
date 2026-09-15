import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { calculerRevisionLoyer, decomposerDate, libelleMoisDepuisDate, resoudreModeleCourrier } from "core";
import {
  alertes,
  appartements,
  bailLocataires,
  baux,
  bien,
  contact,
  documents,
  equipements,
  locataires,
  paiements,
  sinistre,
  tache,
  type Database
} from "db";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";
import { IndicesIrlService } from "../indices-irl/indices-irl.service";
import { ModelesCourrierService } from "../modeles-courrier/modeles-courrier.service";

const LIBELLES_TYPE_EQUIPEMENT: Record<string, string> = {
  chaudiere: "chaudière",
  ballon_eau_chaude: "ballon d'eau chaude",
  autre: "équipement"
};

type AlerteRow = typeof alertes.$inferSelect;
type PaiementRow = typeof paiements.$inferSelect;

interface CibleResolue {
  bailId: string | null;
  appartementId: string | null;
  bienId: string | null;
  organisationId: string;
}

/**
 * Job planifié quotidien (Module Tâches, Étape 1, docs/backlog.md) : dérive
 * une tâche depuis chaque alerte active, pour les 3 types en périmètre
 * (impaye, entretien_equipement, document_expire) — bail_fin_proche et
 * document_expire_proche sont exclus, décision explicite (voir
 * docs/data-dictionary.md, section tache). Tourne après le job Alertes
 * (1h) pour ne traiter que des alertes déjà à jour pour la journée — 4h
 * choisi pour rester compatible avec les futures étapes (révision de loyer
 * aura besoin d'indices_irl à jour, job à 3h).
 *
 * Alertes et Tâches restent deux concepts distincts : ce job ne touche
 * jamais au cycle de vie d'une alerte (statut/derniereConditionVraie), et
 * la synchronisation d'une tâche déjà générée suit son propre cycle de vie
 * (a_faire/en_cours/fait/annulee), sans réutiliser
 * synchroniserAlerte/calculerActionAlerte.
 */
@Injectable()
export class TachesJobService {
  private readonly logger = new Logger(TachesJobService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly indicesIrlService: IndicesIrlService,
    private readonly modelesCourrierService: ModelesCourrierService
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async executerJobQuotidien(): Promise<void> {
    const dateReference = new Date().toISOString().slice(0, 10);
    const nombreCreeesAlertes = await this.genererTachesDepuisAlertes();
    const nombreCreeesRevision = await this.genererTachesRevisionLoyer(dateReference);
    const nombreCreeesQuittance = await this.genererTachesQuittanceMensuelle();
    this.logger.log(
      `Job tâches exécuté : ${nombreCreeesAlertes} tâche(s) depuis alertes, ${nombreCreeesRevision} révision(s) de loyer, ${nombreCreeesQuittance} quittance(s) mensuelle(s).`
    );
  }

  async genererTachesDepuisAlertes(): Promise<number> {
    const alertesActives = await this.db.select().from(alertes).where(eq(alertes.statut, "active"));

    let nombreCreees = 0;
    for (const alerte of alertesActives) {
      // bail_fin_proche / document_expire_proche : hors périmètre de cette
      // étape (voir docs/data-dictionary.md, section tache) — l'alerte
      // seule suffit pour l'instant.
      if (alerte.type === "bail_fin_proche" || alerte.type === "document_expire_proche") {
        continue;
      }

      // Idempotence : ne jamais créer une deuxième tâche active pour la
      // même alerte source — même principe de vérification préalable que
      // synchroniserAlerte (AlertesJobService), pas une dépendance à la
      // violation de l'index unique partiel.
      const [tacheExistante] = await this.db
        .select({ id: tache.id })
        .from(tache)
        .where(and(eq(tache.alerteSourceId, alerte.id), inArray(tache.statut, ["a_faire", "en_cours"])))
        .limit(1);
      if (tacheExistante) {
        continue;
      }

      const cible = await this.resoudreCible(alerte);
      if (!cible) {
        continue;
      }

      // sinistre_stagnation : destinataire = contact assureur, pas un
      // locataire — mécanique de résolution de notification séparée (voir
      // construireMetadataSinistreStagnation).
      const { metadata, locataireId, sinistreId } =
        alerte.type === "sinistre_stagnation"
          ? { ...(await this.construireMetadataSinistreStagnation(alerte)), locataireId: null }
          : { ...(await this.construireMetadataNotification(alerte, cible)), sinistreId: null };

      await this.db.insert(tache).values({
        type: alerte.type,
        statut: "a_faire",
        origine: "alerte",
        alerteSourceId: alerte.id,
        bailId: cible.bailId,
        appartementId: cible.appartementId,
        bienId: cible.bienId,
        locataireId,
        sinistreId,
        dateEcheance: alerte.dateReference,
        organisationId: cible.organisationId,
        metadata
      });
      nombreCreees += 1;
    }
    return nombreCreees;
  }

  /**
   * Dérive une tâche de révision pour chaque bail actif dont c'est
   * aujourd'hui l'anniversaire de `dateDebut` (Module Tâches, Étape 5,
   * docs/backlog.md). Idempotence via l'index unique partiel
   * `tache_bail_periode_revision_active_unique` (bailId, periodeRecurrence),
   * `periodeRecurrence` portant l'année courante en texte. Si l'indice de
   * référence ou l'indice précédent n'est pas encore publié, ne crée rien —
   * le job repasse chaque jour, aucun garde-fou supplémentaire nécessaire.
   */
  async genererTachesRevisionLoyer(dateReference: string): Promise<number> {
    const { annee: anneeActuelle, mois: moisReference, jour: jourReference } = decomposerDate(dateReference);

    const bauxAvecClauseIndexation = await this.db
      .select()
      .from(baux)
      .where(and(eq(baux.statut, "actif"), isNotNull(baux.trimestreReferenceRevision)));

    let nombreCreees = 0;
    for (const bail of bauxAvecClauseIndexation) {
      if (bail.trimestreReferenceRevision === null || !bail.loyerMensuel) {
        continue;
      }
      const { mois: moisDebut, jour: jourDebut } = decomposerDate(bail.dateDebut);
      if (moisDebut !== moisReference || jourDebut !== jourReference) {
        continue;
      }

      const periodeRecurrence = String(anneeActuelle);
      const [tacheExistante] = await this.db
        .select({ id: tache.id })
        .from(tache)
        .where(
          and(
            eq(tache.bailId, bail.id),
            eq(tache.periodeRecurrence, periodeRecurrence),
            eq(tache.type, "revision_loyer"),
            inArray(tache.statut, ["a_faire", "en_cours"])
          )
        )
        .limit(1);
      if (tacheExistante) {
        continue;
      }

      const [indiceReference, indicePrecedent] = await Promise.all([
        this.indicesIrlService.trouverValeur(anneeActuelle, bail.trimestreReferenceRevision),
        this.indicesIrlService.trouverValeur(anneeActuelle - 1, bail.trimestreReferenceRevision)
      ]);
      if (!indiceReference || !indicePrecedent) {
        continue;
      }

      const cible = await this.resoudreDepuisAppartement(bail.appartementId);
      if (!cible) {
        continue;
      }

      // Résolu ici pour la même raison que dans genererTachesDepuisAlertes
      // (Module Tâches, Étape 3 — intégration Gmail, 2026-09-01) :
      // TachesService.envoyerNotification a besoin de locataireId pour
      // résoudre l'email du destinataire, une fois la révision appliquée
      // (statut='en_cours', appliquerRevision) — jamais résolu jusqu'ici
      // sur cette tâche.
      const titulaire = await this.resoudreTitulaire(bail.id);

      const loyerPropose = calculerRevisionLoyer(bail.loyerMensuel, indiceReference.valeur, indicePrecedent.valeur);

      await this.db.insert(tache).values({
        type: "revision_loyer",
        statut: "a_faire",
        origine: "planifiee",
        bailId: bail.id,
        appartementId: bail.appartementId,
        locataireId: titulaire?.id ?? null,
        dateEcheance: dateReference,
        periodeRecurrence,
        organisationId: cible.organisationId,
        metadata: {
          loyerActuel: bail.loyerMensuel,
          loyerPropose,
          trimestreReference: bail.trimestreReferenceRevision,
          anneeReference: anneeActuelle,
          indiceReferenceValeur: indiceReference.valeur,
          indicePrecedentValeur: indicePrecedent.valeur
        }
      });
      nombreCreees += 1;
    }
    return nombreCreees;
  }

  /**
   * Dérive une tâche de quittance mensuelle pour chaque échéance de loyer
   * effectivement RÉGLÉE (Module Tâches, Étape 4, docs/backlog.md) —
   * jamais anticipée avant `paiements.statut = 'paye'` (une quittance
   * atteste un paiement reçu, pas une échéance à venir). origine=
   * 'planifiee', comme revision_loyer : aucune alerte source. Idempotence
   * via l'index unique partiel tache_paiement_active_unique (paiementId) —
   * même garde préalable que les deux autres générateurs de ce job, pas une
   * dépendance à la violation de l'index. Les échéances antérieures à
   * cette étape (loyerHorsCharges/charges NULL, colonnes ajoutées le
   * 2026-08-31) ne sont pas exclues ici : la tâche se crée quand même, la
   * génération du document bloquera explicitement plus tard
   * (validerCompletudeGenerationQuittance, packages/core) plutôt que de
   * les ignorer silencieusement.
   */
  async genererTachesQuittanceMensuelle(): Promise<number> {
    const paiementsRegles = await this.db
      .select()
      .from(paiements)
      .where(and(eq(paiements.type, "loyer"), eq(paiements.statut, "paye"), isNull(paiements.archivedAt)));

    let nombreCreees = 0;
    for (const paiement of paiementsRegles) {
      const [tacheExistante] = await this.db
        .select({ id: tache.id })
        .from(tache)
        .where(and(eq(tache.paiementId, paiement.id), inArray(tache.statut, ["a_faire", "en_cours"])))
        .limit(1);
      if (tacheExistante) {
        continue;
      }

      const cible = await this.resoudreDepuisBail(paiement.bailId);
      if (!cible || !cible.bailId) {
        continue;
      }

      const titulaire = await this.resoudreTitulaire(cible.bailId);
      const metadata = await this.construireMetadataQuittance(paiement, cible, titulaire);

      await this.db.insert(tache).values({
        type: "quittance_mensuelle",
        statut: "a_faire",
        origine: "planifiee",
        bailId: cible.bailId,
        appartementId: cible.appartementId,
        paiementId: paiement.id,
        locataireId: titulaire?.id ?? null,
        dateEcheance: paiement.dateEcheance,
        organisationId: cible.organisationId,
        metadata
      });
      nombreCreees += 1;
    }
    return nombreCreees;
  }

  // alertes n'a pas de colonne entiteType générique (contrairement à
  // documents) : la table cible se déduit de `type` (voir
  // docs/data-dictionary.md, section alertes). bail_fin_proche/
  // document_expire_proche sont déjà exclus par le garde dans
  // genererTachesDepuisAlertes — les deux cas ci-dessous ne sont là que
  // pour l'exhaustivité du switch (jamais atteints en pratique).
  private async resoudreCible(alerte: AlerteRow): Promise<CibleResolue | null> {
    switch (alerte.type) {
      case "bail_fin_proche":
      case "document_expire_proche":
        return null;
      case "impaye": {
        const [paiement] = await this.db
          .select({ bailId: paiements.bailId })
          .from(paiements)
          .where(eq(paiements.id, alerte.entiteId))
          .limit(1);
        if (!paiement) return null;
        return this.resoudreDepuisBail(paiement.bailId);
      }
      case "entretien_equipement": {
        const [equipement] = await this.db
          .select({ appartementId: equipements.appartementId })
          .from(equipements)
          .where(eq(equipements.id, alerte.entiteId))
          .limit(1);
        if (!equipement) return null;
        return this.resoudreDepuisAppartement(equipement.appartementId);
      }
      // Module Suivi sinistre et assurance (2026-09-16) : sinistre porte déjà
      // bienId/appartementId/organisationId directement, aucune traversée
      // bail/appartement nécessaire (contrairement aux 3 cas ci-dessus).
      case "sinistre_stagnation": {
        const [sinistreLigne] = await this.db
          .select({ bienId: sinistre.bienId, appartementId: sinistre.appartementId, organisationId: sinistre.organisationId })
          .from(sinistre)
          .where(eq(sinistre.id, alerte.entiteId))
          .limit(1);
        if (!sinistreLigne) return null;
        return {
          bailId: null,
          appartementId: sinistreLigne.appartementId,
          bienId: sinistreLigne.bienId,
          organisationId: sinistreLigne.organisationId
        };
      }
      case "document_expire": {
        const [document] = await this.db
          .select({ entiteType: documents.entiteType, entiteId: documents.entiteId })
          .from(documents)
          .where(eq(documents.id, alerte.entiteId))
          .limit(1);
        if (!document) return null;
        switch (document.entiteType) {
          case "appartement":
            return this.resoudreDepuisAppartement(document.entiteId);
          case "bail":
            return this.resoudreDepuisBail(document.entiteId);
          case "bien": {
            const [bienTrouve] = await this.db
              .select({ organisationId: bien.organisationId })
              .from(bien)
              .where(eq(bien.id, document.entiteId))
              .limit(1);
            if (!bienTrouve) return null;
            return {
              bailId: null,
              appartementId: null,
              bienId: document.entiteId,
              organisationId: bienTrouve.organisationId
            };
          }
          default:
            // sci, locataire, garant, etat_des_lieux : hors périmètre de
            // cette étape (voir docs/data-dictionary.md, section tache).
            return null;
        }
      }
    }
  }

  private async resoudreDepuisBail(bailId: string): Promise<CibleResolue | null> {
    const [bail] = await this.db.select({ appartementId: baux.appartementId }).from(baux).where(eq(baux.id, bailId)).limit(1);
    if (!bail) return null;
    const cible = await this.resoudreDepuisAppartement(bail.appartementId);
    return cible ? { ...cible, bailId } : null;
  }

  private async resoudreDepuisAppartement(appartementId: string): Promise<CibleResolue | null> {
    const [appartement] = await this.db
      .select({ bienId: appartements.bienId })
      .from(appartements)
      .where(eq(appartements.id, appartementId))
      .limit(1);
    if (!appartement) return null;
    const [bienTrouve] = await this.db
      .select({ organisationId: bien.organisationId })
      .from(bien)
      .where(eq(bien.id, appartement.bienId))
      .limit(1);
    if (!bienTrouve) return null;
    return { bailId: null, appartementId, bienId: null, organisationId: bienTrouve.organisationId };
  }

  /**
   * Résout la notification à joindre à une tâche dérivée d'une alerte
   * (impaye/entretien_equipement/document_expire uniquement — extension du
   * 2026-08-31, docs/backlog.md). Jamais d'envoi silencieusement absent :
   * chaque cas où la notification ne peut pas être construite pose un
   * signal explicite (`notificationIndisponible` + motif) dans le
   * `metadata` de la tâche plutôt que de la laisser vide sans explication.
   * Ne laisse jamais une erreur de résolution (modèle mal formé, donnée
   * source manquante) faire échouer tout le job — une tâche mal notifiée
   * reste préférable à un job qui s'arrête au milieu de la nuit.
   *
   * Retourne aussi `locataireId` (Module Tâches, Étape 3 — intégration
   * Gmail, 2026-09-01) : le titulaire est déjà résolu ici pour construire
   * le texte de la notification, mais n'était jusqu'ici jamais persisté
   * sur la tâche elle-même — trou bloquant pour
   * TachesService.envoyerNotification, qui a besoin de locataireId pour
   * résoudre l'email du destinataire sans re-résoudre le titulaire une
   * seconde fois au moment de l'envoi.
   */
  private async construireMetadataNotification(
    alerte: AlerteRow,
    cible: CibleResolue
  ): Promise<{ metadata: Record<string, unknown> | undefined; locataireId: string | null }> {
    if (alerte.type !== "impaye" && alerte.type !== "entretien_equipement" && alerte.type !== "document_expire") {
      return { metadata: undefined, locataireId: null };
    }
    // bienId seul (document_expire attaché directement à un bien, sans
    // appartement) : hors périmètre de cette extension (audit du
    // 2026-08-31, "cas appartement/bail" uniquement) — aucun titulaire
    // possible à notifier, ce n'est pas une absence de donnée à signaler.
    if (!cible.appartementId) {
      return { metadata: undefined, locataireId: null };
    }

    try {
      const bailId = cible.bailId ?? (await this.resoudreBailActifPourAppartement(cible.appartementId));
      if (!bailId) {
        return { metadata: this.signalNotificationIndisponible("aucun bail actif sur cet appartement"), locataireId: null };
      }

      const titulaire = await this.resoudreTitulaire(bailId);
      if (!titulaire) {
        return { metadata: this.signalNotificationIndisponible("aucun titulaire actif sur le bail"), locataireId: null };
      }

      const libelleBien = await this.resoudreLibelleBien(cible.appartementId);
      if (!libelleBien) {
        return { metadata: this.signalNotificationIndisponible("bien introuvable"), locataireId: titulaire.id };
      }

      const modele = await this.modelesCourrierService.findByCode(alerte.type);
      if (!modele) {
        return {
          metadata: this.signalNotificationIndisponible(`modèle de courrier '${alerte.type}' introuvable`),
          locataireId: titulaire.id
        };
      }

      const variables = await this.construireVariablesNotification(
        alerte,
        `${titulaire.prenom} ${titulaire.nom}`,
        libelleBien
      );
      if (!variables) {
        return { metadata: this.signalNotificationIndisponible("données source introuvables"), locataireId: titulaire.id };
      }

      const { objet, corps } = resoudreModeleCourrier({ objet: modele.objet, corps: modele.corps }, variables);
      return { metadata: { notificationObjet: objet, notificationCorps: corps }, locataireId: titulaire.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Échec de résolution de la notification pour l'alerte ${alerte.id} (${alerte.type}) : ${message}`
      );
      return { metadata: this.signalNotificationIndisponible(`erreur de résolution : ${message}`), locataireId: null };
    }
  }

  private signalNotificationIndisponible(motif: string): Record<string, unknown> {
    return { notificationIndisponible: true, motifNotificationIndisponible: motif };
  }

  /**
   * Résout la notification pour une tâche quittance_mensuelle — même
   * discipline que construireMetadataNotification (jamais silencieux, une
   * erreur de résolution ne doit jamais arrêter le job au milieu de la
   * nuit) mais mécanique séparée : origine='planifiee', pas d'AlerteRow ici
   * (voir genererTachesRevisionLoyer pour le même choix). `periode` est
   * dérivée de dateEcheance (mois/année de l'échéance réglée), jamais de
   * la date du jour.
   */
  private async construireMetadataQuittance(
    paiement: PaiementRow,
    cible: CibleResolue,
    titulaire: { id: string; nom: string; prenom: string } | null
  ): Promise<Record<string, unknown>> {
    if (!titulaire) {
      return this.signalNotificationIndisponible("aucun titulaire actif sur le bail");
    }
    if (!cible.appartementId) {
      return this.signalNotificationIndisponible("appartement introuvable");
    }
    try {
      const libelleBien = await this.resoudreLibelleBien(cible.appartementId);
      if (!libelleBien) {
        return this.signalNotificationIndisponible("bien introuvable");
      }
      const modele = await this.modelesCourrierService.findByCode("quittance_mensuelle");
      if (!modele) {
        return this.signalNotificationIndisponible("modèle de courrier 'quittance_mensuelle' introuvable");
      }
      const { annee } = decomposerDate(paiement.dateEcheance);
      const periode = `${libelleMoisDepuisDate(paiement.dateEcheance)} ${annee}`;
      const variables = {
        nomLocataire: `${titulaire.prenom} ${titulaire.nom}`,
        libelleBien,
        periode,
        montant: paiement.montant
      };
      const { objet, corps } = resoudreModeleCourrier({ objet: modele.objet, corps: modele.corps }, variables);
      return { notificationObjet: objet, notificationCorps: corps };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Échec de résolution de la notification pour le paiement ${paiement.id} (quittance_mensuelle) : ${message}`);
      return this.signalNotificationIndisponible(`erreur de résolution : ${message}`);
    }
  }

  private async construireVariablesNotification(
    alerte: AlerteRow,
    nomLocataire: string,
    libelleBien: string
  ): Promise<Record<string, string> | null> {
    switch (alerte.type) {
      case "impaye": {
        const [paiement] = await this.db.select().from(paiements).where(eq(paiements.id, alerte.entiteId)).limit(1);
        if (!paiement) return null;
        return {
          nomLocataire,
          libelleBien,
          montant: paiement.montant,
          dateEcheance: paiement.dateEcheance,
          typePaiement: paiement.type === "charges" ? "charges" : "loyer"
        };
      }
      case "entretien_equipement": {
        const [equipement] = await this.db
          .select()
          .from(equipements)
          .where(eq(equipements.id, alerte.entiteId))
          .limit(1);
        if (!equipement) return null;
        return {
          nomLocataire,
          libelleBien,
          typeEquipement: LIBELLES_TYPE_EQUIPEMENT[equipement.type] ?? equipement.type,
          dateEcheance: alerte.dateReference
        };
      }
      case "document_expire": {
        const [document] = await this.db.select().from(documents).where(eq(documents.id, alerte.entiteId)).limit(1);
        if (!document) return null;
        return {
          nomLocataire,
          libelleBien,
          nomDocument: document.nomFichier,
          dateExpiration: document.dateExpiration ?? ""
        };
      }
      default:
        return null;
    }
  }

  // Au plus un titulaire non archivé par bail est garanti par l'index
  // unique partiel bail_locataires_bail_id_titulaire_actif_unique
  // (2026-08-31, docs/data-dictionary.md, section bail_locataires) —
  // .limit(1) est donc déterministe, jamais un choix arbitraire parmi
  // plusieurs candidats. Retourne null si le bail n'a aucun titulaire
  // (uniquement des colocataire) — cas volontairement non contraint, à
  // gérer explicitement par l'appelant plutôt que de deviner un notifié.
  private async resoudreTitulaire(bailId: string): Promise<{ id: string; nom: string; prenom: string } | null> {
    const [lien] = await this.db
      .select({ locataireId: bailLocataires.locataireId })
      .from(bailLocataires)
      .where(
        and(eq(bailLocataires.bailId, bailId), eq(bailLocataires.role, "titulaire"), isNull(bailLocataires.archivedAt))
      )
      .limit(1);
    if (!lien) return null;
    const [locataire] = await this.db
      .select({ id: locataires.id, nom: locataires.nom, prenom: locataires.prenom })
      .from(locataires)
      .where(eq(locataires.id, lien.locataireId))
      .limit(1);
    return locataire ?? null;
  }

  // entretien_equipement et document_expire (cas appartement) n'ont qu'un
  // appartementId, pas de bailId direct (contrairement à impaye et
  // document_expire cas bail) — remonte au bail actif/préavis de cet
  // appartement, au plus un par construction
  // (baux_appartement_id_actif_unique).
  private async resoudreBailActifPourAppartement(appartementId: string): Promise<string | null> {
    const [bailActif] = await this.db
      .select({ id: baux.id })
      .from(baux)
      .where(and(eq(baux.appartementId, appartementId), inArray(baux.statut, ["actif", "preavis"])))
      .limit(1);
    return bailActif?.id ?? null;
  }

  private async resoudreLibelleBien(appartementId: string): Promise<string | null> {
    const [appartement] = await this.db
      .select()
      .from(appartements)
      .where(eq(appartements.id, appartementId))
      .limit(1);
    if (!appartement) return null;
    const [bienTrouve] = await this.db.select().from(bien).where(eq(bien.id, appartement.bienId)).limit(1);
    if (!bienTrouve) return null;
    return `${bienTrouve.nom ?? bienTrouve.adresse} — n°${appartement.numero}`;
  }

  // Un sinistre peut être rattaché à un bien seul, sans appartement précis
  // (ex. toiture d'un immeuble entier) — pas de "n°" dans ce cas,
  // contrairement à resoudreLibelleBien ci-dessus.
  private async resoudreLibelleBienDepuisBienId(bienId: string): Promise<string | null> {
    const [bienTrouve] = await this.db.select().from(bien).where(eq(bien.id, bienId)).limit(1);
    return bienTrouve ? bienTrouve.nom ?? bienTrouve.adresse : null;
  }

  /**
   * Résout la notification de relance pour une tâche sinistre_stagnation —
   * mécanique séparée de construireMetadataNotification (Module Suivi
   * sinistre et assurance, 2026-09-16) : le destinataire est un CONTACT
   * (l'assureur), jamais un locataire titulaire d'un bail — le mécanisme
   * tenant-centric ci-dessus ne s'applique pas ici. Même discipline
   * "jamais silencieux" : chaque cas non résolu pose un signal explicite
   * dans le metadata plutôt que de le laisser vide.
   */
  private async construireMetadataSinistreStagnation(
    alerte: AlerteRow
  ): Promise<{ metadata: Record<string, unknown>; sinistreId: string | null }> {
    try {
      const [sinistreLigne] = await this.db.select().from(sinistre).where(eq(sinistre.id, alerte.entiteId)).limit(1);
      if (!sinistreLigne) {
        return { metadata: this.signalNotificationIndisponible("sinistre introuvable"), sinistreId: null };
      }
      if (!sinistreLigne.contactAssureurId) {
        return {
          metadata: this.signalNotificationIndisponible("aucun contact assureur renseigné sur ce sinistre"),
          sinistreId: sinistreLigne.id
        };
      }

      const [contactLigne] = await this.db
        .select()
        .from(contact)
        .where(eq(contact.id, sinistreLigne.contactAssureurId))
        .limit(1);
      if (!contactLigne) {
        return {
          metadata: this.signalNotificationIndisponible("contact assureur introuvable"),
          sinistreId: sinistreLigne.id
        };
      }

      const libelleBien = sinistreLigne.appartementId
        ? await this.resoudreLibelleBien(sinistreLigne.appartementId)
        : sinistreLigne.bienId
          ? await this.resoudreLibelleBienDepuisBienId(sinistreLigne.bienId)
          : null;
      if (!libelleBien) {
        return { metadata: this.signalNotificationIndisponible("bien introuvable"), sinistreId: sinistreLigne.id };
      }

      const modele = await this.modelesCourrierService.findByCode("sinistre_stagnation");
      if (!modele) {
        return {
          metadata: this.signalNotificationIndisponible("modèle de courrier 'sinistre_stagnation' introuvable"),
          sinistreId: sinistreLigne.id
        };
      }

      const variables = {
        nomAssureur: contactLigne.nom,
        libelleBien,
        typeSinistre: sinistreLigne.type,
        dateDeclaration: sinistreLigne.dateDeclaration
      };
      const { objet, corps } = resoudreModeleCourrier({ objet: modele.objet, corps: modele.corps }, variables);
      return { metadata: { notificationObjet: objet, notificationCorps: corps }, sinistreId: sinistreLigne.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Échec de résolution de la notification pour l'alerte ${alerte.id} (sinistre_stagnation) : ${message}`
      );
      return { metadata: this.signalNotificationIndisponible(`erreur de résolution : ${message}`), sinistreId: null };
    }
  }
}
