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
import { bailLocataires, locataires, mettreAJourAvecAudit, paiements, versements, type Database } from "db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreatePaiementDto } from "./dto/create-paiement.dto";
import type { RapprocherCsvDto } from "./dto/rapprocher-csv.dto";
import type { UpdatePaiementDto } from "./dto/update-paiement.dto";

@Injectable()
export class PaiementsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreatePaiementDto) {
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
    return paiement;
  }

  async findAll(bailId?: string) {
    if (bailId) {
      return this.db.select().from(paiements).where(eq(paiements.bailId, bailId));
    }
    return this.db.select().from(paiements);
  }

  async findById(id: string) {
    const [paiement] = await this.db.select().from(paiements).where(eq(paiements.id, id)).limit(1);
    return paiement ?? null;
  }

  // Ne touche jamais aux versements (voir VersementsService), mais si
  // `montant` (dû) change, le statut doit être recalculé contre le montant
  // déjà reçu — jamais laissé périmé.
  async update(id: string, dto: UpdatePaiementDto) {
    const [existant] = await this.db.select().from(paiements).where(eq(paiements.id, id)).limit(1);
    if (!existant) {
      throw new NotFoundException("Paiement introuvable");
    }

    const nouveauMontant = dto.montant ?? existant.montant;
    const versementsActifs = await this.db
      .select()
      .from(versements)
      .where(and(eq(versements.paiementId, id), isNull(versements.archivedAt)));
    const montantRecu = calculerMontantRecuTotal(versementsActifs);
    const statutRecalcule = calculerStatutPaiement(nouveauMontant, montantRecu);

    const [paiement] = await mettreAJourAvecAudit(
      this.db,
      paiements,
      id,
      {
        type: dto.type,
        montant: dto.montant,
        dateEcheance: dto.dateEcheance,
        statut: statutRecalcule
      },
      this.requestContext.getUtilisateurId()
    );
    if (!paiement) {
      throw new NotFoundException("Paiement introuvable");
    }
    return paiement;
  }

  // Cascade vers les versements actifs (docs/data-dictionary.md) : un
  // paiement archivé ne doit jamais laisser des versements "actifs"
  // visibles ailleurs, sans jamais les supprimer physiquement.
  async archive(id: string) {
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
      return paiement;
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

    const paiementsCandidats = await this.db
      .select()
      .from(paiements)
      .where(and(isNull(paiements.archivedAt), inArray(paiements.statut, ["impaye", "partiel"])));

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

    return { lignes, propositions, paiements: paiementsCandidats };
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
}
