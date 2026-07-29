import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  calculerJoursOccupes,
  calculerLoyerNetRecuEcheance,
  calculerProvisionsRecuesEcheance,
  calculerStatutDocument,
  centimesVersMontant,
  dateVersJourOrdinal,
  montantEnCentimes,
  type IntervalleOccupationBail
} from "core";
import { alertes, appartements, baux, documents, immeubles, paiements, scis, type Database } from "db";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";

function dateDuJour(): string {
  return new Date().toISOString().slice(0, 10);
}

function enumererMois(periodeDebut: string, periodeFin: string): string[] {
  const mois: string[] = [];
  let annee = Number(periodeDebut.slice(0, 4));
  let m = Number(periodeDebut.slice(5, 7));
  const anneeFin = Number(periodeFin.slice(0, 4));
  const moisFin = Number(periodeFin.slice(5, 7));
  while (annee < anneeFin || (annee === anneeFin && m <= moisFin)) {
    mois.push(`${annee.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      annee += 1;
    }
  }
  return mois;
}

@Injectable()
export class TableauDeBordService {
  private readonly logger = new Logger(TableauDeBordService.name);

  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async getEnTete() {
    const tousAppartements = await this.db.select().from(appartements).where(isNull(appartements.archivedAt));

    const loues = tousAppartements.filter((a) => a.statut === "loue");
    const vacants = tousAppartements.filter((a) => a.statut === "vacant");
    const travaux = tousAppartements.filter((a) => a.statut === "travaux");

    const valeurLocativeCentimes = loues.reduce(
      (total, a) => total + (a.loyerReference ? montantEnCentimes(a.loyerReference) : 0),
      0
    );

    return {
      biensLoues: loues.length,
      biensVacants: vacants.length,
      biensTravaux: travaux.length,
      valeurLocativeTotale: centimesVersMontant(valeurLocativeCentimes)
    };
  }

  async getCartes() {
    const dateReference = dateDuJour();

    const paiementsEnRetardOuAVenir = await this.db
      .select()
      .from(paiements)
      .where(
        and(
          inArray(paiements.type, ["loyer", "charges"]),
          inArray(paiements.statut, ["impaye", "partiel"]),
          isNull(paiements.archivedAt)
        )
      );

    const impayes = paiementsEnRetardOuAVenir.filter((p) => p.dateEcheance < dateReference);
    const aVenir = paiementsEnRetardOuAVenir.filter((p) => p.dateEcheance >= dateReference);
    const montantRestantImpayesCentimes = impayes.reduce(
      (total, p) => total + (montantEnCentimes(p.montant) - (p.montantPaye ? montantEnCentimes(p.montantPaye) : 0)),
      0
    );

    const tousLesDocuments = await this.db.select().from(documents).where(isNull(documents.archivedAt));
    const documentsExpires = tousLesDocuments.filter(
      (d) => calculerStatutDocument(d.dateExpiration, false, dateReference) === "expire"
    ).length;

    const alertesActives = await this.db.select().from(alertes).where(eq(alertes.statut, "active"));

    return {
      impayes: { nombre: impayes.length, montantRestant: centimesVersMontant(montantRestantImpayesCentimes) },
      echeancesAVenir: aVenir.length,
      documentsExpires,
      alertesActives: alertesActives.length
    };
  }

  async getRevenusLocatifs(periodeDebut: string, periodeFin: string) {
    const paiementsPeriode = await this.db
      .select()
      .from(paiements)
      .where(
        and(
          eq(paiements.type, "loyer"),
          gte(paiements.datePaiement, periodeDebut),
          lte(paiements.datePaiement, periodeFin),
          isNull(paiements.archivedAt)
        )
      );

    const bailIds = [...new Set(paiementsPeriode.map((p) => p.bailId))];
    const bauxConcernes = bailIds.length
      ? await this.db.select().from(baux).where(inArray(baux.id, bailIds))
      : [];
    const bauxParId = new Map(bauxConcernes.map((b) => [b.id, b]));

    const parMoisCentimes = new Map<string, { loyerNet: number; provisions: number }>();
    for (const mois of enumererMois(periodeDebut, periodeFin)) {
      parMoisCentimes.set(mois, { loyerNet: 0, provisions: 0 });
    }

    for (const paiement of paiementsPeriode) {
      const bail = bauxParId.get(paiement.bailId);
      // montant_paye est toujours renseigné dès lors que date_paiement
      // l'est (PaiementsService.enregistrer() pose les deux ensemble), et
      // bail_id est une FK NOT NULL (packages/db/src/schema/paiements.ts) —
      // ce garde-fou ne devrait donc jamais se déclencher en usage normal.
      // Averti plutôt que silencieux : si une évolution future (migration,
      // insertion manuelle) le rend atteignable, un paiement disparaîtrait
      // sinon d'un total financier sans aucune trace.
      if (!bail || !paiement.montantPaye || !bail.loyerMensuel || !paiement.datePaiement) {
        this.logger.warn(
          `Paiement ${paiement.id} exclu du calcul des revenus locatifs (bail introuvable ou données incomplètes) — vérifier l'intégrité des données.`
        );
        continue;
      }
      const mois = paiement.datePaiement.slice(0, 7);
      const cumul = parMoisCentimes.get(mois);
      if (!cumul) {
        continue;
      }
      cumul.loyerNet += montantEnCentimes(
        calculerLoyerNetRecuEcheance(paiement.montantPaye, bail.loyerMensuel, bail.provisionsCharges)
      );
      cumul.provisions += montantEnCentimes(
        calculerProvisionsRecuesEcheance(paiement.montantPaye, bail.loyerMensuel, bail.provisionsCharges)
      );
    }

    const parMois = [...parMoisCentimes.entries()].map(([mois, cumul]) => ({
      mois,
      loyerNet: centimesVersMontant(cumul.loyerNet),
      provisions: centimesVersMontant(cumul.provisions)
    }));

    const totalLoyerNet = parMois.reduce((total, m) => total + montantEnCentimes(m.loyerNet), 0);
    const totalProvisions = parMois.reduce((total, m) => total + montantEnCentimes(m.provisions), 0);

    return {
      periodeDebut,
      periodeFin,
      parMois,
      totalLoyerNet: centimesVersMontant(totalLoyerNet),
      totalProvisions: centimesVersMontant(totalProvisions)
    };
  }

  async getSynthese(periodeDebut: string, periodeFin: string) {
    // Volontairement AUCUN filtre archivedAt sur scis/immeubles/appartements
    // ici : le revenu perçu sur la période est un fait historique, jamais
    // invalidé par un archivage survenu APRÈS coup (ex. appartement vendu
    // le mois suivant). Sans ça, les totaux SCI/immeuble divergeraient
    // silencieusement de getRevenusLocatifs dès qu'un bien quitte le
    // portefeuille — voir docs/data-dictionary.md, section Tableau de bord.
    // Le statut archivé est renvoyé (`archive: boolean`) pour permettre au
    // frontend de masquer la LIGNE de détail par défaut (ArchiveToggle,
    // comme ailleurs dans l'app), sans jamais faire varier les totaux.
    const [tousLesScis, tousLesImmeubles, tousLesAppartements, tousLesBaux, paiementsPeriode] = await Promise.all([
      this.db.select().from(scis),
      this.db.select().from(immeubles),
      this.db.select().from(appartements),
      this.db.select().from(baux),
      this.db
        .select()
        .from(paiements)
        .where(
          and(
            eq(paiements.type, "loyer"),
            gte(paiements.datePaiement, periodeDebut),
            lte(paiements.datePaiement, periodeFin),
            isNull(paiements.archivedAt)
          )
        )
    ]);

    const bauxParId = new Map(tousLesBaux.map((b) => [b.id, b]));

    const revenuNetCentimesParAppartement = new Map<string, number>();
    for (const paiement of paiementsPeriode) {
      const bail = bauxParId.get(paiement.bailId);
      if (!bail || !paiement.montantPaye || !bail.loyerMensuel) {
        this.logger.warn(
          `Paiement ${paiement.id} exclu de la synthèse par appartement (bail introuvable ou données incomplètes) — vérifier l'intégrité des données.`
        );
        continue;
      }
      const revenuNet = montantEnCentimes(
        calculerLoyerNetRecuEcheance(paiement.montantPaye, bail.loyerMensuel, bail.provisionsCharges)
      );
      revenuNetCentimesParAppartement.set(
        bail.appartementId,
        (revenuNetCentimesParAppartement.get(bail.appartementId) ?? 0) + revenuNet
      );
    }

    const bauxParAppartement = new Map<string, IntervalleOccupationBail[]>();
    for (const bail of tousLesBaux) {
      const liste = bauxParAppartement.get(bail.appartementId) ?? [];
      liste.push({ dateDebut: bail.dateDebut, dateFin: bail.dateFin, dateActivation: bail.dateActivation });
      bauxParAppartement.set(bail.appartementId, liste);
    }

    const syntheseParAppartement = new Map(
      tousLesAppartements.map((appartement) => [
        appartement.id,
        {
          id: appartement.id,
          numero: appartement.numero,
          revenuNet: centimesVersMontant(revenuNetCentimesParAppartement.get(appartement.id) ?? 0),
          joursOccupes: calculerJoursOccupes(bauxParAppartement.get(appartement.id) ?? [], periodeDebut, periodeFin)
        }
      ])
    );

    const joursPeriode = dateVersJourOrdinal(periodeFin) - dateVersJourOrdinal(periodeDebut) + 1;

    // Un appartement archivé AVANT le début de la période interrogée
    // n'appartenait plus au parc pendant toute cette période : il est exclu
    // du DÉNOMINATEUR du taux d'occupation moyen (sinon un bien vendu/démoli
    // continuerait indéfiniment à tirer la moyenne vers le bas pour toute
    // période future interrogée). Le revenu n'a pas ce problème : une somme
    // accepte naturellement une contribution de 0 €, une moyenne divisée par
    // un effectif non. Voir docs/data-dictionary.md, section Tableau de bord.
    function estArchiveAvantPeriode(archivedAt: Date | null): boolean {
      return archivedAt !== null && archivedAt.toISOString().slice(0, 10) < periodeDebut;
    }

    return tousLesScis.map((sci) => {
      const immeublesDeCetteSci = tousLesImmeubles.filter((immeuble) => immeuble.sciId === sci.id);
      const immeublesCalcules = immeublesDeCetteSci.map((immeuble) => {
        const appartementsDeCetImmeuble = tousLesAppartements.filter((a) => a.immeubleId === immeuble.id);
        const appartementsResultat = appartementsDeCetImmeuble.map((appartement) => {
          const synthese = syntheseParAppartement.get(appartement.id);
          return {
            id: appartement.id,
            numero: appartement.numero,
            revenuNet: synthese?.revenuNet ?? "0.00",
            tauxOccupation:
              joursPeriode > 0 ? Number(((synthese?.joursOccupes ?? 0) / joursPeriode).toFixed(4)) : 0,
            archive: appartement.archivedAt !== null
          };
        });
        const revenuNetImmeubleCentimes = appartementsResultat.reduce(
          (total, a) => total + montantEnCentimes(a.revenuNet),
          0
        );
        const idsExclusOccupation = new Set(
          appartementsDeCetImmeuble.filter((a) => estArchiveAvantPeriode(a.archivedAt)).map((a) => a.id)
        );
        const appartementsPourOccupation = appartementsResultat.filter((a) => !idsExclusOccupation.has(a.id));
        const tauxOccupationImmeuble =
          appartementsPourOccupation.length > 0
            ? appartementsPourOccupation.reduce((total, a) => total + a.tauxOccupation, 0) /
              appartementsPourOccupation.length
            : 0;
        return {
          resultat: {
            id: immeuble.id,
            nom: immeuble.nom,
            revenuNet: centimesVersMontant(revenuNetImmeubleCentimes),
            tauxOccupation: Number(tauxOccupationImmeuble.toFixed(4)),
            archive: immeuble.archivedAt !== null,
            appartements: appartementsResultat
          },
          nbPourOccupation: appartementsPourOccupation.length
        };
      });
      const immeublesResultat = immeublesCalcules.map((i) => i.resultat);
      const revenuNetSciCentimes = immeublesResultat.reduce((total, i) => total + montantEnCentimes(i.revenuNet), 0);
      const appartementsTotalPourOccupation = immeublesCalcules.reduce(
        (total, i) => total + i.nbPourOccupation,
        0
      );
      const tauxOccupationSci =
        appartementsTotalPourOccupation > 0
          ? immeublesCalcules.reduce(
              (total, i) => total + i.resultat.tauxOccupation * i.nbPourOccupation,
              0
            ) / appartementsTotalPourOccupation
          : 0;
      return {
        id: sci.id,
        nom: sci.nom,
        revenuNet: centimesVersMontant(revenuNetSciCentimes),
        tauxOccupation: Number(tauxOccupationSci.toFixed(4)),
        archive: sci.archivedAt !== null,
        immeubles: immeublesResultat
      };
    });
  }
}
