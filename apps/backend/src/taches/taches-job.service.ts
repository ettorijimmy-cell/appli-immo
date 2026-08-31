import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { calculerRevisionLoyer, decomposerDate } from "core";
import { alertes, appartements, baux, bien, documents, equipements, paiements, tache, type Database } from "db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";
import { IndicesIrlService } from "../indices-irl/indices-irl.service";

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
    private readonly indicesIrlService: IndicesIrlService
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

      await this.db.insert(tache).values({
        type: alerte.type,
        statut: "a_faire",
        origine: "alerte",
        alerteSourceId: alerte.id,
        bailId: cible.bailId,
        appartementId: cible.appartementId,
        bienId: cible.bienId,
        dateEcheance: alerte.dateReference,
        organisationId: cible.organisationId
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
}
