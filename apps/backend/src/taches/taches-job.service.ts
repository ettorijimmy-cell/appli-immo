import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { calculerRevisionLoyer, decomposerDate, resoudreModeleCourrier } from "core";
import {
  alertes,
  appartements,
  bailLocataires,
  baux,
  bien,
  documents,
  equipements,
  locataires,
  paiements,
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
    this.logger.log(
      `Job tâches exécuté : ${nombreCreeesAlertes} tâche(s) depuis alertes, ${nombreCreeesRevision} révision(s) de loyer.`
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

      const metadata = await this.construireMetadataNotification(alerte, cible);

      await this.db.insert(tache).values({
        type: alerte.type,
        statut: "a_faire",
        origine: "alerte",
        alerteSourceId: alerte.id,
        bailId: cible.bailId,
        appartementId: cible.appartementId,
        bienId: cible.bienId,
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

      const loyerPropose = calculerRevisionLoyer(bail.loyerMensuel, indiceReference.valeur, indicePrecedent.valeur);

      await this.db.insert(tache).values({
        type: "revision_loyer",
        statut: "a_faire",
        origine: "planifiee",
        bailId: bail.id,
        appartementId: bail.appartementId,
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
   */
  private async construireMetadataNotification(
    alerte: AlerteRow,
    cible: CibleResolue
  ): Promise<Record<string, unknown> | undefined> {
    if (alerte.type !== "impaye" && alerte.type !== "entretien_equipement" && alerte.type !== "document_expire") {
      return undefined;
    }
    // bienId seul (document_expire attaché directement à un bien, sans
    // appartement) : hors périmètre de cette extension (audit du
    // 2026-08-31, "cas appartement/bail" uniquement) — aucun titulaire
    // possible à notifier, ce n'est pas une absence de donnée à signaler.
    if (!cible.appartementId) {
      return undefined;
    }

    try {
      const bailId = cible.bailId ?? (await this.resoudreBailActifPourAppartement(cible.appartementId));
      if (!bailId) {
        return this.signalNotificationIndisponible("aucun bail actif sur cet appartement");
      }

      const titulaire = await this.resoudreTitulaire(bailId);
      if (!titulaire) {
        return this.signalNotificationIndisponible("aucun titulaire actif sur le bail");
      }

      const libelleBien = await this.resoudreLibelleBien(cible.appartementId);
      if (!libelleBien) {
        return this.signalNotificationIndisponible("bien introuvable");
      }

      const modele = await this.modelesCourrierService.findByCode(alerte.type);
      if (!modele) {
        return this.signalNotificationIndisponible(`modèle de courrier '${alerte.type}' introuvable`);
      }

      const variables = await this.construireVariablesNotification(
        alerte,
        `${titulaire.prenom} ${titulaire.nom}`,
        libelleBien
      );
      if (!variables) {
        return this.signalNotificationIndisponible("données source introuvables");
      }

      const { objet, corps } = resoudreModeleCourrier({ objet: modele.objet, corps: modele.corps }, variables);
      return { notificationObjet: objet, notificationCorps: corps };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Échec de résolution de la notification pour l'alerte ${alerte.id} (${alerte.type}) : ${message}`
      );
      return this.signalNotificationIndisponible(`erreur de résolution : ${message}`);
    }
  }

  private signalNotificationIndisponible(motif: string): Record<string, unknown> {
    return { notificationIndisponible: true, motifNotificationIndisponible: motif };
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
  private async resoudreTitulaire(bailId: string): Promise<{ nom: string; prenom: string } | null> {
    const [lien] = await this.db
      .select({ locataireId: bailLocataires.locataireId })
      .from(bailLocataires)
      .where(
        and(eq(bailLocataires.bailId, bailId), eq(bailLocataires.role, "titulaire"), isNull(bailLocataires.archivedAt))
      )
      .limit(1);
    if (!lien) return null;
    const [locataire] = await this.db
      .select({ nom: locataires.nom, prenom: locataires.prenom })
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
}
