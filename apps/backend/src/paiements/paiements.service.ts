import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  calculerStatutPaiement,
  parserReleveCsv,
  proposerRapprochements,
  type LigneReleveCsvAvecId,
  type PaiementARapprocher
} from "core";
import { bailLocataires, locataires, mettreAJourAvecAudit, paiements, type Database } from "db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreatePaiementDto } from "./dto/create-paiement.dto";
import type { EnregistrerPaiementDto } from "./dto/enregistrer-paiement.dto";
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

  // Ne touche jamais à montant_paye/mode/date_paiement/reference_rapprochement
  // (voir UpdatePaiementDto), mais si `montant` change, le statut doit être
  // recalculé contre le montant déjà reçu — jamais laissé périmé.
  async update(id: string, dto: UpdatePaiementDto) {
    const [existant] = await this.db.select().from(paiements).where(eq(paiements.id, id)).limit(1);
    if (!existant) {
      throw new NotFoundException("Paiement introuvable");
    }

    const nouveauMontant = dto.montant ?? existant.montant;
    const statutRecalcule = calculerStatutPaiement(nouveauMontant, existant.montantPaye);

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

  // Seule voie d'écriture pour montant_paye/mode/date_paiement/
  // reference_rapprochement — utilisée aussi bien pour l'enregistrement
  // manuel en ligne (Finances) que pour la confirmation d'un rapprochement
  // CSV (le frontend fournit alors referenceRapprochement = libellé de la
  // ligne retenue). Le statut est toujours recalculé ici, jamais saisi.
  async enregistrer(id: string, dto: EnregistrerPaiementDto) {
    const [existant] = await this.db.select().from(paiements).where(eq(paiements.id, id)).limit(1);
    if (!existant) {
      throw new NotFoundException("Paiement introuvable");
    }

    const statut = calculerStatutPaiement(existant.montant, dto.montantPaye);

    const [paiement] = await mettreAJourAvecAudit(
      this.db,
      paiements,
      id,
      {
        montantPaye: dto.montantPaye,
        mode: dto.mode,
        datePaiement: dto.datePaiement,
        referenceRapprochement: dto.referenceRapprochement ?? null,
        statut
      },
      this.requestContext.getUtilisateurId()
    );
    if (!paiement) {
      throw new NotFoundException("Paiement introuvable");
    }
    return paiement;
  }

  // Corrige un rapprochement incorrect (docs/backlog.md, critère de
  // complétion du Module 5) : remet le paiement à impaye pour permettre un
  // nouvel enregistrement avec les bonnes données.
  async annulerEnregistrement(id: string) {
    const [paiement] = await mettreAJourAvecAudit(
      this.db,
      paiements,
      id,
      {
        montantPaye: null,
        mode: null,
        datePaiement: null,
        referenceRapprochement: null,
        statut: "impaye"
      },
      this.requestContext.getUtilisateurId()
    );
    if (!paiement) {
      throw new NotFoundException("Paiement introuvable");
    }
    return paiement;
  }

  async archive(id: string) {
    const [paiement] = await mettreAJourAvecAudit(
      this.db,
      paiements,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!paiement) {
      throw new NotFoundException("Paiement introuvable");
    }
    return paiement;
  }

  // Ne fait QUE proposer (packages/core, proposerRapprochements) — aucune
  // écriture. La confirmation d'un candidat passe par enregistrer(), un
  // acte explicite distinct (voir docs/data-dictionary.md, section
  // paiements, pour la décision produit sur ce point).
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

    const paiementsARapprocher: PaiementARapprocher[] = paiementsCandidats.map((paiement) => ({
      id: paiement.id,
      montant: paiement.montant,
      dateEcheance: paiement.dateEcheance,
      nomsLocataires: nomsParBail.get(paiement.bailId) ?? []
    }));

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
