import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  calculerMontantRecuTotal,
  calculerStatutPaiement,
  centimesVersMontant,
  montantEnCentimes,
  parserReleveCsv,
  proposerRapprochements,
  type LigneReleveCsvAvecId,
  type PaiementARapprocher
} from "core";
import { appartements, bailLocataires, baux, bien, locataires, mettreAJourAvecAudit, paiements, versements, type Database } from "db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreatePaiementDto } from "./dto/create-paiement.dto";
import type { RapprocherCsvDto } from "./dto/rapprocher-csv.dto";
import type { UpdatePaiementDto } from "./dto/update-paiement.dto";

type PaiementRow = typeof paiements.$inferSelect;

@Injectable()
export class PaiementsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreatePaiementDto) {
    await this.verifierAppartenanceBail(dto.bailId);

    const [paiement] = await this.db
      .insert(paiements)
      .values({
        bailId: dto.bailId,
        type: dto.type,
        montant: dto.montant,
        dateEcheance: dto.dateEcheance
      })
      .returning();
    if (!paiement) {
      throw new Error("Échec de la création du paiement");
    }
    return this.versDto(paiement);
  }

  // Contrôle d'appartenance sur dto.bailId (Priorité E3, chantier scoping
  // multi-organisation, Catégorie E, 2026-09-19) : create() ne vérifiait
  // jusqu'ici ni l'existence ni l'appartenance — sans colonne
  // organisationId propre sur paiements, un bailId d'une autre organisation
  // faisait apparaître le paiement créé (montant, échéance) directement
  // dans les finances de l'organisation propriétaire réelle du bail. Même
  // chaîne de jointure que findAll() ci-dessous. Skip si organisationId
  // absent (hors contexte HTTP). Même message "Bail introuvable" pour id
  // inexistant et id d'une autre organisation.
  private async verifierAppartenanceBail(bailId: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
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

  // paiements n'a pas de colonne organisationId directe : le scoping passe
  // par une triple jointure paiements -> baux -> appartements -> bien
  // (bien.organisationId), même profondeur que BailLocatairesService.
  async findAll(bailId?: string) {
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const conditions = [
        eq(bien.organisationId, organisationId),
        ...(bailId ? [eq(paiements.bailId, bailId)] : [])
      ];
      const rows = await this.db
        .select({ paiement: paiements })
        .from(paiements)
        .innerJoin(baux, eq(baux.id, paiements.bailId))
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(...conditions));
      return rows.map((row) => this.versDto(row.paiement));
    }
    const lignes = bailId
      ? await this.db.select().from(paiements).where(eq(paiements.bailId, bailId))
      : await this.db.select().from(paiements);
    return lignes.map((paiement) => this.versDto(paiement));
  }

  // Contrôle d'appartenance (Sous-commit 5c, chantier scoping
  // multi-organisation, 2026-09-18) : paiements n'a pas de colonne
  // organisationId directe (voir findAll() ci-dessus), le contrôle passe
  // par une triple jointure baux -> appartements -> bien. Même message
  // que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  async findById(id: string) {
    const paiement = await this.resoudrePaiementAvecAppartenance(id);
    return this.versDto(paiement);
  }

  // Ne touche jamais aux versements (voir VersementsService), mais si
  // `montant` (dû) change, le statut doit être recalculé contre le montant
  // déjà reçu — jamais laissé périmé.
  async update(id: string, dto: UpdatePaiementDto) {
    // Contrôle d'appartenance AVANT toute lecture/écriture (Priorité 3b,
    // Catégorie C, chantier scoping multi-organisation, 2026-09-19).
    const existant = await this.resoudrePaiementAvecAppartenance(id);

    const nouveauMontant = dto.montant ?? existant.montant;
    const versementsActifs = await this.db
      .select()
      .from(versements)
      .where(and(eq(versements.paiementId, id), isNull(versements.archivedAt)));
    const montantRecu = calculerMontantRecuTotal(versementsActifs);
    const statutRecalcule = calculerStatutPaiement(nouveauMontant, montantRecu);

    // loyerHorsCharges/charges (Module Tâches, Étape 4 — quittance
    // mensuelle) sont FIGÉS à la génération de l'échéance et garantis égaux
    // à montant à ce moment-là (loyerHorsCharges + charges = montant, voir
    // AlertesJobService.genererEcheancesRecurrentes). Si montant change
    // ensuite, cet invariant casserait silencieusement — une quittance
    // générée après coup afficherait le montant figé PÉRIMÉ, pas le
    // montant corrigé (revue financial-logic-reviewer, 2026-08-31).
    // Invalidés explicitement plutôt que laissés périmés :
    // validerCompletudeGenerationQuittance (packages/core) bloque alors la
    // génération jusqu'à ce que l'échéance soit reconciliée, plutôt que de
    // deviner ou d'imprimer une valeur fausse.
    const montantModifie = dto.montant !== undefined && dto.montant !== existant.montant;
    const echeanceEtaitFigee = existant.loyerHorsCharges !== null || existant.charges !== null;

    const [paiement] = await mettreAJourAvecAudit(
      this.db,
      paiements,
      id,
      {
        type: dto.type,
        montant: dto.montant,
        dateEcheance: dto.dateEcheance,
        statut: statutRecalcule,
        ...(montantModifie && echeanceEtaitFigee ? { loyerHorsCharges: null, charges: null } : {})
      },
      this.requestContext.getUtilisateurId()
    );
    if (!paiement) {
      throw new NotFoundException("Paiement introuvable");
    }
    return this.versDto(paiement as PaiementRow);
  }

  // Cascade vers les versements actifs (docs/data-dictionary.md) : un
  // paiement archivé ne doit jamais laisser des versements "actifs"
  // visibles ailleurs, sans jamais les supprimer physiquement.
  async archive(id: string) {
    // Contrôle d'appartenance AVANT l'ouverture de la transaction (Priorité
    // 3b, Catégorie C, chantier scoping multi-organisation, 2026-09-19) :
    // avant toute lecture, avant la cascade d'archivage des versements
    // actifs, avant l'archivage du paiement lui-même.
    await this.resoudrePaiementAvecAppartenance(id);

    return this.db.transaction(async (tx) => {
      const utilisateurId = this.requestContext.getUtilisateurId();

      await tx
        .update(versements)
        .set({
          archivedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: utilisateurId,
          version: sql`${versements.version} + 1`
        })
        .where(and(eq(versements.paiementId, id), isNull(versements.archivedAt)));

      const [paiement] = await mettreAJourAvecAudit(
        tx,
        paiements,
        id,
        { archivedAt: new Date() },
        utilisateurId
      );
      if (!paiement) {
        throw new NotFoundException("Paiement introuvable");
      }
      return this.versDto(paiement as PaiementRow);
    });
  }

  // Ne fait QUE proposer (packages/core, proposerRapprochements) — aucune
  // écriture. La confirmation d'un candidat ajoute un versement
  // (VersementsService.ajouter), un acte explicite distinct (voir
  // docs/data-dictionary.md, section paiements, pour la décision produit
  // sur ce point).
  async rapprocherCsv(dto: RapprocherCsvDto) {
    const lignesBrutes = parserReleveCsv(dto.contenuCsv);
    const lignes: LigneReleveCsvAvecId[] = lignesBrutes.map((ligne, index) => ({
      id: `ligne-${index}`,
      ...ligne
    }));

    // Scoping critique (chantier scoping multi-organisation, Commit 4b) :
    // sans ce filtre, une ligne de relevé bancaire d'une organisation
    // pouvait être proposée en rapprochement contre une échéance impayée
    // d'une AUTRE organisation — pas seulement une liste trop large
    // affichée, un vrai risque de mélange de données financières entre
    // organisations réelles (voir docs/data-dictionary.md pour le détail).
    const organisationId = this.requestContext.getOrganisationId();
    const conditionsCandidats = and(isNull(paiements.archivedAt), inArray(paiements.statut, ["impaye", "partiel"]));
    const paiementsCandidats: PaiementRow[] = organisationId
      ? (
          await this.db
            .select({ paiement: paiements })
            .from(paiements)
            .innerJoin(baux, eq(baux.id, paiements.bailId))
            .innerJoin(appartements, eq(appartements.id, baux.appartementId))
            .innerJoin(bien, eq(bien.id, appartements.bienId))
            .where(and(conditionsCandidats, eq(bien.organisationId, organisationId)))
        ).map((row) => row.paiement)
      : await this.db.select().from(paiements).where(conditionsCandidats);

    const bailIds = [...new Set(paiementsCandidats.map((paiement) => paiement.bailId))];
    const nomsParBail = await this.recupererNomsLocatairesParBail(bailIds);

    // Matche sur le SOLDE RESTANT (montant dû - versements actifs), pas le
    // montant total dû : un paiement déjà partiellement réglé redevient
    // proposable au rapprochement pour son solde (docs/data-dictionary.md,
    // section "versements & remboursements"). L'ambiguïté (une ligne CSV
    // correspond par coïncidence à plusieurs critères de paiements
    // différents) reste gérée par la règle déjà en place dans
    // proposerRapprochements, inchangée : tous les candidats sont
    // présentés, jamais de choix silencieux.
    const paiementIds = paiementsCandidats.map((paiement) => paiement.id);
    const versementsDesCandidats = paiementIds.length
      ? await this.db
          .select()
          .from(versements)
          .where(and(inArray(versements.paiementId, paiementIds), isNull(versements.archivedAt)))
      : [];
    const versementsParPaiement = new Map<string, typeof versementsDesCandidats>();
    for (const versement of versementsDesCandidats) {
      const liste = versementsParPaiement.get(versement.paiementId) ?? [];
      liste.push(versement);
      versementsParPaiement.set(versement.paiementId, liste);
    }

    const paiementsARapprocher: PaiementARapprocher[] = paiementsCandidats.map((paiement) => {
      const montantRecu = calculerMontantRecuTotal(versementsParPaiement.get(paiement.id) ?? []);
      const soldeRestant = centimesVersMontant(montantEnCentimes(paiement.montant) - montantEnCentimes(montantRecu));
      return {
        id: paiement.id,
        montant: soldeRestant,
        dateEcheance: paiement.dateEcheance,
        nomsLocataires: nomsParBail.get(paiement.bailId) ?? []
      };
    });

    const propositions = proposerRapprochements(lignes, paiementsARapprocher);

    return { lignes, propositions, paiements: paiementsCandidats.map((paiement) => this.versDto(paiement)) };
  }

  private async recupererNomsLocatairesParBail(bailIds: string[]): Promise<Map<string, string[]>> {
    const resultat = new Map<string, string[]>();
    if (bailIds.length === 0) {
      return resultat;
    }

    const lignes = await this.db
      .select({
        bailId: bailLocataires.bailId,
        nom: locataires.nom,
        prenom: locataires.prenom
      })
      .from(bailLocataires)
      .innerJoin(locataires, eq(locataires.id, bailLocataires.locataireId))
      .where(and(inArray(bailLocataires.bailId, bailIds), isNull(bailLocataires.archivedAt)));

    for (const ligne of lignes) {
      const noms = resultat.get(ligne.bailId) ?? [];
      noms.push(ligne.nom, ligne.prenom);
      resultat.set(ligne.bailId, noms);
    }
    return resultat;
  }

  // Contrôle d'appartenance partagé (Sous-commit 5c pour findById(), étendu
  // en Priorité 3b/Catégorie C à update()/archive() — 2026-09-19) : même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  private async resoudrePaiementAvecAppartenance(id: string): Promise<PaiementRow> {
    const [paiement] = await this.db.select().from(paiements).where(eq(paiements.id, id)).limit(1);
    if (!paiement) {
      throw new NotFoundException("Paiement introuvable");
    }
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const [ligne] = await this.db
        .select({ id: paiements.id })
        .from(paiements)
        .innerJoin(baux, eq(baux.id, paiements.bailId))
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(eq(paiements.id, id), eq(bien.organisationId, organisationId)))
        .limit(1);
      if (!ligne) {
        throw new NotFoundException("Paiement introuvable");
      }
    }
    return paiement;
  }

  private versDto(paiement: PaiementRow) {
    return {
      id: paiement.id,
      createdAt: paiement.createdAt,
      updatedAt: paiement.updatedAt,
      updatedBy: paiement.updatedBy,
      version: paiement.version,
      archivedAt: paiement.archivedAt,
      bailId: paiement.bailId,
      type: paiement.type,
      statut: paiement.statut,
      montant: paiement.montant,
      dateEcheance: paiement.dateEcheance,
      loyerHorsCharges: paiement.loyerHorsCharges,
      charges: paiement.charges
    };
  }
}
