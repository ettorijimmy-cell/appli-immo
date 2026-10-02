import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  calculerBilanRegularisation,
  calculerProvisionsRecuesEcheance,
  centimesVersMontant,
  montantEnCentimes,
  type BilanRegularisation
} from "core";
import { appartements, baux, bien, depense, paiements, versements, type Database } from "db";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";

export interface BilanRegularisationBail extends BilanRegularisation {
  bailId: string;
  periodeDebut: string;
  periodeFin: string;
  provisionsRecues: string;
  chargesReelles: string;
}

/**
 * Calcul seul (Module Régularisation des charges, Sous-commit C,
 * docs/backlog.md) — pas de création de tâche ici, voir
 * TachesJobService.genererTachesRegularisationCharges (déclencheur
 * automatique) et son usage côté endpoint manuel (BauxController). Service
 * séparé plutôt qu'ajouté à TachesService : le calcul ne touche à aucune
 * tâche et doit rester appelable de façon strictement en lecture (affichage
 * seul si faveur_locataire) — même raisonnement de séparation que
 * FiscaliteService/TableauDeBordService (calcul pur sur un domaine propre,
 * consommé par un autre service pour l'action qui en découle).
 */
@Injectable()
export class RegularisationChargesService {
  private readonly logger = new Logger(RegularisationChargesService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  /**
   * Provisions perçues : paiements.charges figé (échéances type='loyer',
   * jamais ré-estimé depuis baux.loyerMensuel/provisionsCharges actuels —
   * contrairement à TableauDeBordService.getRevenusLocatifs, qui reste une
   * ESTIMATION sur valeurs courantes) + montant plein des versements sur
   * échéances type='charges' autonomes (aucune part loyer à exclure sur
   * ce type). depot_garantie est hors périmètre (pas une provision pour
   * charges). Charges réelles : depense.appartementId + dateDepense dans la
   * période, **recuperable = true uniquement** (Module Régularisation des
   * charges, Sous-commit E, correction du Sous-commit C — décret n° 87-713
   * du 26 août 1987 : seule une charge récupérable auprès du locataire
   * entre dans ce bilan, jamais une charge que le propriétaire supporte
   * seul). Un seul point d'entrée vers ce calcul (TachesJobService.
   * genererTacheRegularisationSiNecessaire, lui-même utilisé par le
   * déclenchement automatique ET le endpoint manuel) : corriger ce filtre
   * ici suffit à couvrir les deux chemins.
   */
  async calculerBilanPourBail(bailId: string, periodeDebut: string, periodeFin: string): Promise<BilanRegularisationBail> {
    if (periodeFin < periodeDebut) {
      throw new ConflictException("La fin de période ne peut pas précéder le début de période.");
    }
    const bail = await this.resoudreBailAvecAppartenance(bailId);

    const versementsPeriode = await this.db
      .select({
        montant: versements.montant,
        paiementType: paiements.type,
        loyerHorsCharges: paiements.loyerHorsCharges,
        charges: paiements.charges
      })
      .from(versements)
      .innerJoin(paiements, eq(versements.paiementId, paiements.id))
      .where(
        and(
          eq(paiements.bailId, bailId),
          inArray(paiements.type, ["loyer", "charges"]),
          gte(versements.dateVersement, periodeDebut),
          lte(versements.dateVersement, periodeFin),
          isNull(versements.archivedAt),
          isNull(paiements.archivedAt)
        )
      );

    let centimesProvisions = 0;
    for (const versement of versementsPeriode) {
      if (versement.paiementType === "charges") {
        centimesProvisions += montantEnCentimes(versement.montant);
        continue;
      }
      // type='loyer' : la part provisions dépend de la décomposition figée
      // à la génération de l'échéance (loyerHorsCharges/charges). Absente
      // sur les échéances antérieures au 2026-08-31 (voir paiements.ts) —
      // exclue plutôt qu'estimée depuis le bail courant, pour rester
      // fidèle à la décision actée (jamais de ré-estimation silencieuse).
      if (versement.loyerHorsCharges === null) {
        this.logger.warn(
          `Versement exclu du bilan de régularisation du bail ${bailId} (échéance loyer sans décomposition figée loyerHorsCharges/charges).`
        );
        continue;
      }
      centimesProvisions += montantEnCentimes(
        calculerProvisionsRecuesEcheance(versement.montant, versement.loyerHorsCharges, versement.charges)
      );
    }

    const depensesPeriode = await this.db
      .select({ montant: depense.montant })
      .from(depense)
      .where(
        and(
          eq(depense.appartementId, bail.appartementId),
          eq(depense.recuperable, true),
          gte(depense.dateDepense, periodeDebut),
          lte(depense.dateDepense, periodeFin),
          isNull(depense.archivedAt)
        )
      );
    const centimesCharges = depensesPeriode.reduce((total, ligne) => total + montantEnCentimes(ligne.montant), 0);

    const provisionsRecues = centimesVersMontant(centimesProvisions);
    const chargesReelles = centimesVersMontant(centimesCharges);
    const bilan = calculerBilanRegularisation(provisionsRecues, chargesReelles);

    return { bailId, periodeDebut, periodeFin, provisionsRecues, chargesReelles, ...bilan };
  }

  // Même principe que BauxService.findById : baux n'a pas de colonne
  // organisationId directe, contrôle par double jointure
  // appartements -> bien. Skip si organisationId absent du contexte (appel
  // depuis TachesJobService, hors requête HTTP).
  private async resoudreBailAvecAppartenance(bailId: string) {
    const [bail] = await this.db.select().from(baux).where(eq(baux.id, bailId)).limit(1);
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const [ligne] = await this.db
        .select({ id: baux.id })
        .from(baux)
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(eq(baux.id, bailId), eq(bien.organisationId, organisationId)))
        .limit(1);
      if (!ligne) {
        throw new NotFoundException("Bail introuvable");
      }
    }
    return bail;
  }
}
