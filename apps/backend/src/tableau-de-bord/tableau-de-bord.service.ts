import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  calculerBornesMoisCalendaire,
  calculerJoursOccupes,
  calculerLoyerNetRecuEcheance,
  calculerMontantEcheanceLoyer,
  calculerMontantRecuTotal,
  calculerProrataOccupationPartielle,
  calculerProvisionsRecuesEcheance,
  calculerStatutDocument,
  centimesVersMontant,
  dateVersJourOrdinal,
  evaluerCompletudeCategories,
  montantEnCentimes,
  type CompletudeCategorie,
  type DocumentPourCompletude,
  type IntervalleOccupationBail
} from "core";
import {
  alertes,
  appartements,
  bailLocataires,
  baux,
  bien,
  documents,
  garants,
  paiements,
  remboursements,
  scis,
  versements,
  type Database
} from "db";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { DATABASE_CONNECTION } from "../database/database.module";

function dateDuJour(): string {
  return new Date().toISOString().slice(0, 10);
}

// Mêmes 4 catégories que la détection de présence en annexe du bail
// (BailDocumentDocxService), mais un critère plus strict : 'valide' au sens
// de calculerStatutDocument (expiration comprise), pas seulement "non
// archivé" — un diagnostic expiré compte comme "présent" pour l'annexe d'un
// bail déjà signé, mais comme "manquant" pour la checklist (docs/backlog.md,
// checklist documentaire — deux besoins différents, pas une incohérence).
const CATEGORIES_DIAGNOSTIC_APPARTEMENT = ["dpe", "elec_gaz", "crep_plomb", "erp"] as const;

// Adapte une ligne `documents` brute vers la forme attendue par
// evaluerCompletudeCategories (packages/core) — même fonction de détection
// que getChecklistDocumentaire()/getCompletudeDocumentaire() ci-dessous,
// jamais dupliquée.
function mapDocumentPourCompletude(document: {
  id: string;
  categorie: string;
  nomFichier: string;
  dateExpiration: string | null;
  archivedAt: Date | null;
  createdAt: Date;
}): DocumentPourCompletude {
  return {
    id: document.id,
    categorie: document.categorie,
    nomFichier: document.nomFichier,
    dateExpiration: document.dateExpiration,
    archive: document.archivedAt !== null,
    createdAt: document.createdAt.toISOString()
  };
}

function groupeDocumentsParEntite(
  lignes: Array<{
    id: string;
    entiteId: string;
    categorie: string;
    nomFichier: string;
    dateExpiration: string | null;
    archivedAt: Date | null;
    createdAt: Date;
  }>
): Map<string, DocumentPourCompletude[]> {
  const groupes = new Map<string, DocumentPourCompletude[]>();
  for (const ligne of lignes) {
    const liste = groupes.get(ligne.entiteId) ?? [];
    liste.push(mapDocumentPourCompletude(ligne));
    groupes.set(ligne.entiteId, liste);
  }
  return groupes;
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

    const paiementIds = impayes.map((p) => p.id);
    const versementsDesImpayes = paiementIds.length
      ? await this.db
          .select()
          .from(versements)
          .where(and(inArray(versements.paiementId, paiementIds), isNull(versements.archivedAt)))
      : [];
    const versementsParPaiement = new Map<string, typeof versementsDesImpayes>();
    for (const versement of versementsDesImpayes) {
      const liste = versementsParPaiement.get(versement.paiementId) ?? [];
      liste.push(versement);
      versementsParPaiement.set(versement.paiementId, liste);
    }
    const montantRestantImpayesCentimes = impayes.reduce((total, p) => {
      const montantRecu = calculerMontantRecuTotal(versementsParPaiement.get(p.id) ?? []);
      return total + (montantEnCentimes(p.montant) - montantEnCentimes(montantRecu));
    }, 0);

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

  // Itère sur les VERSEMENTS (docs/data-dictionary.md, section "versements
  // & remboursements"), jamais sur un unique paiement.montant_paye/
  // date_paiement — chaque versement est attribué au mois de sa PROPRE
  // date_versement. Corrige en effet de bord la limite documentée "paiement
  // en plusieurs versements non représentable" (docs/backlog.md, dette
  // technique) : un versement du 5 et un second du 20 comptent désormais
  // chacun dans le bon mois, jamais tous les deux attribués au dernier.
  // Filtre bien/sci optionnel (Module Charges et fiscalité, Étape 3,
  // cockpit "Comptabilité") : résout d'abord l'ensemble des appartements
  // autorisés, puis exclut toute ligne dont le bail ne pointe pas vers un
  // de ces appartements — jamais un second calcul de revenu, la même
  // agrégation par versement ci-dessous, juste restreinte en amont.
  // sciId seul (sans bienId) couvre tous les biens de la SCI ; bienId
  // l'emporte si les deux sont fournis (cohérent avec DepensesService
  // .create, où bienId dérive toujours sciId, jamais l'inverse).
  async getRevenusLocatifs(
    periodeDebut: string,
    periodeFin: string,
    filtres: { bienId?: string; sciId?: string } = {}
  ) {
    let appartementIdsAutorises: string[] | null = null;
    if (filtres.bienId || filtres.sciId) {
      const conditions = [];
      if (filtres.bienId) {
        conditions.push(eq(appartements.bienId, filtres.bienId));
      } else if (filtres.sciId) {
        conditions.push(eq(bien.sciId, filtres.sciId));
      }
      const appartementsAutorises = await this.db
        .select({ id: appartements.id })
        .from(appartements)
        .innerJoin(bien, eq(appartements.bienId, bien.id))
        .where(and(...conditions));
      appartementIdsAutorises = appartementsAutorises.map((a) => a.id);
    }

    const versementsPeriode = await this.db
      .select({
        id: versements.id,
        montant: versements.montant,
        dateVersement: versements.dateVersement,
        bailId: paiements.bailId
      })
      .from(versements)
      .innerJoin(paiements, eq(versements.paiementId, paiements.id))
      .where(
        and(
          eq(paiements.type, "loyer"),
          gte(versements.dateVersement, periodeDebut),
          lte(versements.dateVersement, periodeFin),
          isNull(versements.archivedAt),
          isNull(paiements.archivedAt)
        )
      );

    const bailIds = [...new Set(versementsPeriode.map((v) => v.bailId))];
    const bauxConcernes = bailIds.length
      ? await this.db.select().from(baux).where(inArray(baux.id, bailIds))
      : [];
    const bauxParId = new Map(bauxConcernes.map((b) => [b.id, b]));

    const parMoisCentimes = new Map<string, { loyerNet: number; provisions: number }>();
    for (const mois of enumererMois(periodeDebut, periodeFin)) {
      parMoisCentimes.set(mois, { loyerNet: 0, provisions: 0 });
    }

    for (const versement of versementsPeriode) {
      const bail = bauxParId.get(versement.bailId);
      // bail_id est une FK NOT NULL (paiements), et un versement porte
      // toujours montant/date_versement (colonnes NOT NULL, versements.ts)
      // — ce garde-fou ne devrait donc jamais se déclencher en usage
      // normal. Averti plutôt que silencieux : si une évolution future
      // (migration, insertion manuelle) le rend atteignable, un versement
      // disparaîtrait sinon d'un total financier sans aucune trace.
      if (!bail || !bail.loyerMensuel) {
        this.logger.warn(
          `Versement ${versement.id} exclu du calcul des revenus locatifs (bail introuvable ou loyer non renseigné) — vérifier l'intégrité des données.`
        );
        continue;
      }
      if (appartementIdsAutorises && !appartementIdsAutorises.includes(bail.appartementId)) {
        continue;
      }
      const mois = versement.dateVersement.slice(0, 7);
      const cumul = parMoisCentimes.get(mois);
      if (!cumul) {
        continue;
      }
      cumul.loyerNet += montantEnCentimes(
        calculerLoyerNetRecuEcheance(versement.montant, bail.loyerMensuel, bail.provisionsCharges)
      );
      cumul.provisions += montantEnCentimes(
        calculerProvisionsRecuesEcheance(versement.montant, bail.loyerMensuel, bail.provisionsCharges)
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

  // Carte "Remboursements en attente" (docs/data-dictionary.md, section
  // "versements & remboursements") : calculée à la volée, jamais stockée —
  // BauxService.resilier() ne fait qu'exposer le trop-perçu au moment de
  // la résiliation (décision D3, jamais écrit en base), donc ce calcul
  // doit être reproduit ici pour rester visible tant qu'aucun remboursement
  // ne le couvre. Ne filtre JAMAIS par statut archivé de l'appartement, de
  // l'immeuble ou du bail concerné (même principe que le correctif Module 7
  // sur les revenus/le taux d'occupation) : un trop-perçu réel reste une
  // obligation financière réelle même après un archivage ultérieur.
  async getRemboursementsEnAttente() {
    const bauxResilies = await this.db.select().from(baux).where(isNotNull(baux.dateFin));
    const resultats: Array<{ bailId: string; paiementId: string; montant: string }> = [];

    for (const bail of bauxResilies) {
      if (!bail.loyerMensuel || !bail.dateFin) {
        continue;
      }

      const { debutMoisInclus, debutMoisSuivantExclusif } = calculerBornesMoisCalendaire(bail.dateFin);
      const [echeanceDuMois] = await this.db
        .select()
        .from(paiements)
        .where(
          and(
            eq(paiements.bailId, bail.id),
            eq(paiements.type, "loyer"),
            isNull(paiements.archivedAt),
            gte(paiements.dateEcheance, debutMoisInclus),
            lt(paiements.dateEcheance, debutMoisSuivantExclusif)
          )
        )
        .limit(1);
      if (!echeanceDuMois) {
        continue;
      }

      const versementsActifs = await this.db
        .select()
        .from(versements)
        .where(and(eq(versements.paiementId, echeanceDuMois.id), isNull(versements.archivedAt)));
      const montantRecu = calculerMontantRecuTotal(versementsActifs);

      const montantPlein = calculerMontantEcheanceLoyer(bail.loyerMensuel, bail.provisionsCharges);
      const montantProratise = calculerProrataOccupationPartielle(montantPlein, bail.dateFin, bail.dateDebut);

      const centimesTropPercu = montantEnCentimes(montantRecu) - montantEnCentimes(montantProratise);
      if (centimesTropPercu <= 0) {
        continue;
      }

      const remboursementsExistants = await this.db
        .select()
        .from(remboursements)
        .where(and(eq(remboursements.paiementId, echeanceDuMois.id), isNull(remboursements.archivedAt)));
      const centimesDejaRembourses = remboursementsExistants.reduce(
        (total, r) => total + montantEnCentimes(r.montantRembourse),
        0
      );
      if (centimesDejaRembourses >= centimesTropPercu) {
        continue;
      }

      resultats.push({
        bailId: bail.id,
        paiementId: echeanceDuMois.id,
        montant: centimesVersMontant(centimesTropPercu - centimesDejaRembourses)
      });
    }

    return resultats;
  }

  // Checklist documentaire (docs/backlog.md) : calculée à la volée, jamais
  // stockée — même philosophie que getRemboursementsEnAttente() ci-dessus,
  // volume négligeable à l'échelle de l'app (~20 logements, CLAUDE.md). Ne
  // renvoie QUE les entités avec au moins un document manquant, jamais un
  // état exhaustif de tout ce qui va bien.
  async getChecklistDocumentaire() {
    const dateReference = dateDuJour();

    // --- Appartements : DPE/élec-gaz/CREP/ERP, rattachés à l'appartement OU
    // à son bien parent (même logique de détection que
    // BailDocumentDocxService). Appartements archivés exclus : un bien qui
    // ne fait plus partie du parc n'a plus besoin d'être diagnostiqué.
    const tousAppartements = await this.db.select().from(appartements).where(isNull(appartements.archivedAt));
    const appartementIds = tousAppartements.map((a) => a.id);
    const bienIds = [...new Set(tousAppartements.map((a) => a.bienId))];

    const documentsDiagnostics =
      appartementIds.length > 0
        ? await this.db
            .select()
            .from(documents)
            .where(
              and(
                or(
                  and(eq(documents.entiteType, "appartement"), inArray(documents.entiteId, appartementIds)),
                  and(eq(documents.entiteType, "bien"), inArray(documents.entiteId, bienIds))
                ),
                inArray(documents.categorie, [...CATEGORIES_DIAGNOSTIC_APPARTEMENT])
              )
            )
            .orderBy(desc(documents.createdAt))
        : [];

    const documentsParAppartement = new Map<string, DocumentPourCompletude[]>();
    const documentsParBien = new Map<string, DocumentPourCompletude[]>();
    for (const d of documentsDiagnostics) {
      const cible = d.entiteType === "appartement" ? documentsParAppartement : documentsParBien;
      const liste = cible.get(d.entiteId) ?? [];
      liste.push(mapDocumentPourCompletude(d));
      cible.set(d.entiteId, liste);
    }

    const appartementsChecklist = tousAppartements.reduce<
      Array<{ appartementId: string; bienId: string | null; categoriesManquantes: string[] }>
    >((liste, appartement) => {
      const documentsCombines = [
        ...(documentsParAppartement.get(appartement.id) ?? []),
        ...(documentsParBien.get(appartement.bienId) ?? [])
      ];
      const completude = evaluerCompletudeCategories(
        documentsCombines,
        [...CATEGORIES_DIAGNOSTIC_APPARTEMENT],
        dateReference
      );
      const categoriesManquantes = completude.filter((c) => c.document === null).map((c) => c.categorie);
      if (categoriesManquantes.length > 0) {
        liste.push({ appartementId: appartement.id, bienId: appartement.bienId, categoriesManquantes });
      }
      return liste;
    }, []);

    // --- Locataires actifs : rattachés via bail_locataires non archivé à
    // un bail statut actif/préavis (décision tranchée avec l'utilisateur —
    // pas les locataires historiques).
    const locatairesActifs = await this.db
      .select({ locataireId: bailLocataires.locataireId, bailId: bailLocataires.bailId })
      .from(bailLocataires)
      .innerJoin(baux, eq(bailLocataires.bailId, baux.id))
      .where(and(isNull(bailLocataires.archivedAt), inArray(baux.statut, ["actif", "preavis"])));

    const locataireIds = [...new Set(locatairesActifs.map((l) => l.locataireId))];
    const documentsPieceIdentiteLocataires =
      locataireIds.length > 0
        ? await this.db
            .select()
            .from(documents)
            .where(
              and(
                eq(documents.entiteType, "locataire"),
                inArray(documents.entiteId, locataireIds),
                eq(documents.categorie, "piece_identite")
              )
            )
            .orderBy(desc(documents.createdAt))
        : [];
    const documentsParLocataire = groupeDocumentsParEntite(documentsPieceIdentiteLocataires);

    const locatairesChecklist = locatairesActifs
      .filter(
        (l) =>
          evaluerCompletudeCategories(
            documentsParLocataire.get(l.locataireId) ?? [],
            ["piece_identite"],
            dateReference
          )[0]?.document === null
      )
      .map((l) => ({ locataireId: l.locataireId, bailId: l.bailId }));

    // --- Garants actifs : bailId pointant vers un bail statut actif/
    // préavis, garant lui-même non archivé (contrairement à locataires,
    // garants.bailId est une FK directe — un garant appartient à un seul
    // bail dès sa création, pas de table de jonction à filtrer).
    const garantsActifs = await this.db
      .select({ id: garants.id, bailId: garants.bailId })
      .from(garants)
      .innerJoin(baux, eq(garants.bailId, baux.id))
      .where(and(isNull(garants.archivedAt), inArray(baux.statut, ["actif", "preavis"])));

    const garantIds = garantsActifs.map((g) => g.id);
    const documentsPieceIdentiteGarants =
      garantIds.length > 0
        ? await this.db
            .select()
            .from(documents)
            .where(
              and(
                eq(documents.entiteType, "garant"),
                inArray(documents.entiteId, garantIds),
                eq(documents.categorie, "piece_identite")
              )
            )
            .orderBy(desc(documents.createdAt))
        : [];
    const documentsParGarant = groupeDocumentsParEntite(documentsPieceIdentiteGarants);

    const garantsChecklist = garantsActifs
      .filter(
        (g) =>
          evaluerCompletudeCategories(documentsParGarant.get(g.id) ?? [], ["piece_identite"], dateReference)[0]
            ?.document === null
      )
      .map((g) => ({ garantId: g.id, bailId: g.bailId }));

    return { appartements: appartementsChecklist, locataires: locatairesChecklist, garants: garantsChecklist };
  }

  // Vue détaillée pour une entité précise (desktop, DocumentsForEntite) —
  // contrairement à getChecklistDocumentaire() ci-dessus, renvoie le statut
  // COMPLET (y compris les catégories déjà satisfaites, avec le document
  // trouvé) plutôt que seulement ce qui manque. Réutilise la même fonction
  // de détection (evaluerCompletudeCategories) — seule la forme du résultat
  // diffère, jamais la règle de "qu'est-ce qui compte comme valide"
  // (docs/backlog.md, checklist documentaire).
  async getCompletudeDocumentaire(
    entiteType: "appartement" | "locataire" | "garant",
    entiteId: string
  ): Promise<CompletudeCategorie[]> {
    const dateReference = dateDuJour();

    if (entiteType === "appartement") {
      const [appartement] = await this.db.select().from(appartements).where(eq(appartements.id, entiteId)).limit(1);
      if (!appartement) {
        throw new NotFoundException("Appartement introuvable");
      }
      const documentsCombines = await this.db
        .select()
        .from(documents)
        .where(
          or(
            and(eq(documents.entiteType, "appartement"), eq(documents.entiteId, entiteId)),
            and(eq(documents.entiteType, "bien"), eq(documents.entiteId, appartement.bienId))
          )
        )
        .orderBy(desc(documents.createdAt));
      return evaluerCompletudeCategories(
        documentsCombines.map(mapDocumentPourCompletude),
        [...CATEGORIES_DIAGNOSTIC_APPARTEMENT],
        dateReference
      );
    }

    if (entiteType !== "locataire" && entiteType !== "garant") {
      throw new BadRequestException("entiteType doit être appartement, locataire ou garant.");
    }
    const documentsDeLEntite = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.entiteType, entiteType), eq(documents.entiteId, entiteId)))
      .orderBy(desc(documents.createdAt));
    return evaluerCompletudeCategories(documentsDeLEntite.map(mapDocumentPourCompletude), ["piece_identite"], dateReference);
  }

  async getSynthese(periodeDebut: string, periodeFin: string) {
    // Volontairement AUCUN filtre archivedAt sur scis/bien/appartements
    // ici : le revenu perçu sur la période est un fait historique, jamais
    // invalidé par un archivage survenu APRÈS coup (ex. appartement vendu
    // le mois suivant). Sans ça, les totaux SCI/bien divergeraient
    // silencieusement de getRevenusLocatifs dès qu'un bien quitte le
    // portefeuille — voir docs/data-dictionary.md, section Tableau de bord.
    // Le statut archivé est renvoyé (`archive: boolean`) pour permettre au
    // frontend de masquer la LIGNE de détail par défaut (ArchiveToggle,
    // comme ailleurs dans l'app), sans jamais faire varier les totaux.
    //
    // Migré le 2026-08-26 (migration bien, Étape 4) : hiérarchie construite
    // depuis bien/appartements.bien_id, plus immeubles/appartements.
    // immeuble_id — sans ce changement, tout appartement créé après cette
    // date (bien_id seul renseigné, AppartementsService n'écrit plus
    // immeuble_id) disparaissait silencieusement de cette synthèse. Ne
    // couvre que les biens rattachés à une SCI (bien.sci_id), exactement
    // comme le comportement précédent avec immeubles.sci_id NOT NULL — un
    // bien en nom propre (proprietaire_type='personne_physique') n'a pas
    // sa place dans cette vue organisée par SCI, avant comme après cette
    // migration (pas une régression introduite ici).
    const [tousLesScis, tousLesBiens, tousLesAppartements, tousLesBaux, versementsPeriode] = await Promise.all([
      this.db.select().from(scis),
      this.db.select().from(bien),
      this.db.select().from(appartements),
      this.db.select().from(baux),
      this.db
        .select({ id: versements.id, montant: versements.montant, bailId: paiements.bailId })
        .from(versements)
        .innerJoin(paiements, eq(versements.paiementId, paiements.id))
        .where(
          and(
            eq(paiements.type, "loyer"),
            gte(versements.dateVersement, periodeDebut),
            lte(versements.dateVersement, periodeFin),
            isNull(versements.archivedAt),
            isNull(paiements.archivedAt)
          )
        )
    ]);

    const bauxParId = new Map(tousLesBaux.map((b) => [b.id, b]));

    const revenuNetCentimesParAppartement = new Map<string, number>();
    for (const versement of versementsPeriode) {
      const bail = bauxParId.get(versement.bailId);
      if (!bail || !bail.loyerMensuel) {
        this.logger.warn(
          `Versement ${versement.id} exclu de la synthèse par appartement (bail introuvable ou loyer non renseigné) — vérifier l'intégrité des données.`
        );
        continue;
      }
      const revenuNet = montantEnCentimes(
        calculerLoyerNetRecuEcheance(versement.montant, bail.loyerMensuel, bail.provisionsCharges)
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
      const biensDeCetteSci = tousLesBiens.filter((b) => b.sciId === sci.id);
      const biensCalcules = biensDeCetteSci.map((b) => {
        const appartementsDeCeBien = tousLesAppartements.filter((a) => a.bienId === b.id);
        const appartementsResultat = appartementsDeCeBien.map((appartement) => {
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
        const revenuNetBienCentimes = appartementsResultat.reduce(
          (total, a) => total + montantEnCentimes(a.revenuNet),
          0
        );
        const idsExclusOccupation = new Set(
          appartementsDeCeBien.filter((a) => estArchiveAvantPeriode(a.archivedAt)).map((a) => a.id)
        );
        const appartementsPourOccupation = appartementsResultat.filter((a) => !idsExclusOccupation.has(a.id));
        const tauxOccupationBien =
          appartementsPourOccupation.length > 0
            ? appartementsPourOccupation.reduce((total, a) => total + a.tauxOccupation, 0) /
              appartementsPourOccupation.length
            : 0;
        return {
          resultat: {
            id: b.id,
            nom: b.nom ?? b.adresse,
            revenuNet: centimesVersMontant(revenuNetBienCentimes),
            tauxOccupation: Number(tauxOccupationBien.toFixed(4)),
            archive: b.archivedAt !== null,
            appartements: appartementsResultat
          },
          nbPourOccupation: appartementsPourOccupation.length
        };
      });
      const biensResultat = biensCalcules.map((i) => i.resultat);
      const revenuNetSciCentimes = biensResultat.reduce((total, i) => total + montantEnCentimes(i.revenuNet), 0);
      const appartementsTotalPourOccupation = biensCalcules.reduce(
        (total, i) => total + i.nbPourOccupation,
        0
      );
      const tauxOccupationSci =
        appartementsTotalPourOccupation > 0
          ? biensCalcules.reduce(
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
        biens: biensResultat
      };
    });
  }
}
