import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  calculerActionAlerte,
  calculerAlerteBailFinProche,
  calculerAlerteDocumentExpire,
  calculerAlerteDocumentExpireProche,
  calculerAlerteEntretienEquipement,
  calculerAlerteImpaye,
  calculerBornesMoisCalendaire,
  calculerDateEcheanceRecurrente,
  calculerMontantEcheanceLoyer,
  calculerProchaineDateEntretien,
  calculerStatutDocument
} from "core";
import { alertes, baux, documents, equipements, mettreAJourAvecAudit, paiements, type Database } from "db";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { AlertesConfigService } from "./alertes-config.service";
import type { AlerteType } from "./alertes-config.service";

interface SynchroniserAlerteParams {
  type: AlerteType;
  entiteId: string;
  conditionActuelle: boolean;
  dateReference: string;
  message: string;
}

/**
 * Job planifié quotidien (docs/backlog.md, Module 6) : deux responsabilités
 * distinctes, dans cet ordre (la seconde doit voir les échéances que la
 * première vient de créer, notamment pour l'alerte impaye).
 *
 * 1. genererEcheancesRecurrentes : matérialise l'échéance de loyer du mois
 *    CALENDAIRE COURANT pour chaque bail actif/preavis qui n'en a pas déjà
 *    une — jamais un mois antérieur (voir docs/data-dictionary.md, section
 *    baux, "Décision produit — génération récurrente des échéances").
 * 2. genererAlertes : les 5 types, chacun via sa règle pure (packages/core)
 *    et `synchroniserAlerte` ci-dessous pour l'ouverture/fermeture — voir
 *    docs/data-dictionary.md, section alertes, pour le cycle de vie complet
 *    (active/traitee/ignoree/resolue).
 */
@Injectable()
export class AlertesJobService {
  private readonly logger = new Logger(AlertesJobService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly config: AlertesConfigService,
    private readonly requestContext: RequestContextService
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async executerJobQuotidien(): Promise<void> {
    const dateReference = new Date().toISOString().slice(0, 10);
    await this.genererEcheancesRecurrentes(dateReference);
    await this.genererAlertes(dateReference);
    this.logger.log(`Job alertes/échéances exécuté pour ${dateReference}`);
  }

  async genererEcheancesRecurrentes(dateReference: string): Promise<void> {
    const bauxActifs = await this.db
      .select()
      .from(baux)
      .where(inArray(baux.statut, ["actif", "preavis"]));

    const { debutMoisInclus, debutMoisSuivantExclusif } = calculerBornesMoisCalendaire(dateReference);

    for (const bail of bauxActifs) {
      // Garde-fous défensifs : jourEcheance/loyerMensuel sont requis pour
      // activer() un bail (docs/data-dictionary.md), ne devraient jamais
      // être null ici.
      if (!bail.jourEcheance || !bail.loyerMensuel) {
        continue;
      }
      const debutMoisDateDebut = calculerBornesMoisCalendaire(bail.dateDebut).debutMoisInclus;
      if (debutMoisInclus < debutMoisDateDebut) {
        continue;
      }

      const [echeanceExistante] = await this.db
        .select({ id: paiements.id })
        .from(paiements)
        .where(
          and(
            eq(paiements.bailId, bail.id),
            eq(paiements.type, "loyer"),
            gte(paiements.dateEcheance, debutMoisInclus),
            lt(paiements.dateEcheance, debutMoisSuivantExclusif)
          )
        )
        .limit(1);
      if (echeanceExistante) {
        continue;
      }

      await this.db.insert(paiements).values({
        bailId: bail.id,
        type: "loyer",
        montant: calculerMontantEcheanceLoyer(bail.loyerMensuel, bail.provisionsCharges),
        dateEcheance: calculerDateEcheanceRecurrente(dateReference, bail.jourEcheance)
      });
    }
  }

  async genererAlertes(dateReference: string): Promise<void> {
    await this.genererAlertesBailFinProche(dateReference);
    await this.genererAlertesDocuments(dateReference);
    await this.genererAlertesEntretienEquipement(dateReference);
    await this.genererAlertesImpaye(dateReference);
  }

  /**
   * Ouvre, ferme ou rouvre une alerte selon l'état de sa condition
   * déclenchante et son historique — voir docs/data-dictionary.md, section
   * alertes, pour le cycle de vie complet :
   * - Aucune alerte existante : crée si `conditionActuelle`, sinon rien.
   * - Dernière alerte `active` : ferme (`resolue`) si la condition n'est
   *   plus vraie, sinon ne touche à rien (déjà signalée) — `statut` seul
   *   porte l'information utilisateur, `derniereConditionVraie` suit en
   *   silence.
   * - Dernière alerte `resolue` : rouvre EN PLACE (`active`, même ligne)
   *   si la condition redevient vraie, sinon ne touche à rien.
   * - Dernière alerte `traitee`/`ignoree` : décision humaine définitive
   *   pour CETTE occurrence, le `statut` n'est JAMAIS réécrit. Une
   *   NOUVELLE ligne n'est créée que sur une vraie transition faux→vrai de
   *   `derniereConditionVraie` (ex. paiement repassé impayé via
   *   `annulerEnregistrement()` après avoir été marqué payé) — jamais
   *   simplement parce que la condition est encore vraie aujourd'hui
   *   (sinon une alerte `bail_fin_proche` déjà traitée, dont la condition
   *   reste vraie indéfiniment, se dupliquerait chaque jour).
   *
   * Toujours la ligne la plus récente qui fait foi (`ORDER BY created_at
   * DESC LIMIT 1`) : plusieurs lignes historiques peuvent coexister pour un
   * même (type, entiteId), une par occurrence.
   */
  private async synchroniserAlerte(params: SynchroniserAlerteParams): Promise<void> {
    const { type, entiteId, conditionActuelle, dateReference, message } = params;

    const [derniereAlerte] = await this.db
      .select()
      .from(alertes)
      .where(and(eq(alertes.type, type), eq(alertes.entiteId, entiteId)))
      .orderBy(desc(alertes.createdAt))
      .limit(1);

    // La décision (que faire ?) est une fonction pure de packages/core,
    // testée unitairement sans base de données — cette méthode ne fait
    // qu'exécuter l'action retournée (CLAUDE.md : logique métier hors
    // apps/backend).
    const action = calculerActionAlerte(
      derniereAlerte?.statut ?? null,
      derniereAlerte?.derniereConditionVraie ?? false,
      conditionActuelle
    );
    const utilisateurId = this.requestContext.getUtilisateurId();

    switch (action.action) {
      case "aucune":
        return;
      case "creer":
        await this.db.insert(alertes).values({ type, entiteId, dateReference, message, derniereConditionVraie: true });
        return;
      case "fermer":
        await mettreAJourAvecAudit(
          this.db,
          alertes,
          derniereAlerte!.id,
          { statut: "resolue", derniereConditionVraie: false },
          utilisateurId
        );
        return;
      case "rouvrir":
        await mettreAJourAvecAudit(
          this.db,
          alertes,
          derniereAlerte!.id,
          { statut: "active", dateReference, message, derniereConditionVraie: true },
          utilisateurId
        );
        return;
      case "maj_condition":
        await mettreAJourAvecAudit(
          this.db,
          alertes,
          derniereAlerte!.id,
          { derniereConditionVraie: action.conditionVraie },
          utilisateurId
        );
        return;
    }
  }

  private async genererAlertesBailFinProche(dateReference: string): Promise<void> {
    const seuil = await this.config.getSeuil("bail_fin_proche");
    // Tous les baux (pas seulement actif/preavis) : un bail qui sort de ce
    // statut (résilié, archivé) doit pouvoir refermer une alerte encore
    // active — voir synchroniserAlerte.
    const tousLesBaux = await this.db.select().from(baux);

    for (const bail of tousLesBaux) {
      const enCours = bail.statut === "actif" || bail.statut === "preavis";
      const condition = enCours && calculerAlerteBailFinProche(bail.dateFin, seuil, dateReference);
      await this.synchroniserAlerte({
        type: "bail_fin_proche",
        entiteId: bail.id,
        conditionActuelle: condition,
        dateReference: bail.dateFin ?? dateReference,
        message: `Le bail se termine le ${bail.dateFin} (seuil ${seuil} j).`
      });
    }
  }

  private async genererAlertesDocuments(dateReference: string): Promise<void> {
    const seuilProche = await this.config.getSeuil("document_expire_proche");
    // Tous les documents (y compris archivés) : calculerStatutDocument gère
    // déjà archivedAt (statut "archive", jamais expire/valide), donc un
    // document archivé referme naturellement ses alertes.
    const tousLesDocuments = await this.db.select().from(documents);

    for (const document of tousLesDocuments) {
      const statut = calculerStatutDocument(document.dateExpiration, document.archivedAt !== null, dateReference);

      await this.synchroniserAlerte({
        type: "document_expire",
        entiteId: document.id,
        conditionActuelle: calculerAlerteDocumentExpire(statut),
        dateReference: document.dateExpiration ?? dateReference,
        message: `Le document "${document.nomFichier}" a expiré le ${document.dateExpiration}.`
      });

      await this.synchroniserAlerte({
        type: "document_expire_proche",
        entiteId: document.id,
        conditionActuelle: calculerAlerteDocumentExpireProche(
          document.dateExpiration,
          statut,
          seuilProche,
          dateReference
        ),
        dateReference: document.dateExpiration ?? dateReference,
        message: `Le document "${document.nomFichier}" expire le ${document.dateExpiration} (seuil ${seuilProche} j).`
      });
    }
  }

  private async genererAlertesEntretienEquipement(dateReference: string): Promise<void> {
    const seuil = await this.config.getSeuil("entretien_equipement");
    // Tous les équipements (y compris archivés) : un équipement archivé
    // doit pouvoir refermer une alerte encore active.
    const tousLesEquipements = await this.db.select().from(equipements);

    for (const equipement of tousLesEquipements) {
      const nonArchive = equipement.archivedAt === null;
      const condition =
        nonArchive &&
        calculerAlerteEntretienEquipement(
          equipement.dateDernierEntretien,
          equipement.intervalleEntretienMois,
          seuil,
          dateReference
        );
      const prochaineDate =
        equipement.dateDernierEntretien && equipement.intervalleEntretienMois
          ? calculerProchaineDateEntretien(equipement.dateDernierEntretien, equipement.intervalleEntretienMois)
          : dateReference;

      await this.synchroniserAlerte({
        type: "entretien_equipement",
        entiteId: equipement.id,
        conditionActuelle: condition,
        dateReference: prochaineDate,
        message: `Entretien de l'équipement (${equipement.type}) attendu le ${prochaineDate}.`
      });
    }
  }

  private async genererAlertesImpaye(dateReference: string): Promise<void> {
    const seuilGrace = await this.config.getSeuil("impaye");
    // Tous les paiements loyer/charges (y compris payés/archivés) : un
    // paiement qui redevient payé (ou est archivé) doit pouvoir refermer
    // une alerte encore active.
    const tousLesPaiements = await this.db.select().from(paiements).where(inArray(paiements.type, ["loyer", "charges"]));

    for (const paiement of tousLesPaiements) {
      const nonArchive = paiement.archivedAt === null;
      const enRetardStatut = paiement.statut === "impaye" || paiement.statut === "partiel";
      const condition = nonArchive && enRetardStatut && calculerAlerteImpaye(paiement.dateEcheance, seuilGrace, dateReference);

      await this.synchroniserAlerte({
        type: "impaye",
        entiteId: paiement.id,
        conditionActuelle: condition,
        dateReference: paiement.dateEcheance,
        message: `Paiement ${paiement.type} en retard, échéance du ${paiement.dateEcheance}.`
      });
    }
  }
}
