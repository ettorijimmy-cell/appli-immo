import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculerMontantRecuTotal, calculerStatutPaiement } from "core";
import { mettreAJourAvecAudit, paiements, versements, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateVersementDto } from "./dto/create-versement.dto";

@Injectable()
export class VersementsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async findAll(paiementId?: string) {
    if (paiementId) {
      return this.db.select().from(versements).where(eq(versements.paiementId, paiementId));
    }
    return this.db.select().from(versements);
  }

  // Ajoute un encaissement réel à un paiement, sans jamais écraser les
  // précédents (docs/data-dictionary.md, section "versements &
  // remboursements") — remplace l'ancien PaiementsService.enregistrer(),
  // qui écrasait montant_paye à chaque appel. Recalcule et persiste le
  // statut du paiement après ajout, jamais laissé périmé.
  async ajouter(dto: CreateVersementDto) {
    const [paiement] = await this.db.select().from(paiements).where(eq(paiements.id, dto.paiementId)).limit(1);
    if (!paiement) {
      throw new NotFoundException("Paiement introuvable");
    }

    const [versement] = await this.db
      .insert(versements)
      .values({
        paiementId: dto.paiementId,
        montant: dto.montant,
        dateVersement: dto.dateVersement,
        mode: dto.mode,
        referenceRapprochement: dto.referenceRapprochement ?? null
      })
      .returning();
    if (!versement) {
      throw new Error("Échec de l'ajout du versement");
    }

    await this.recalculerStatutPaiement(dto.paiementId, paiement.montant);

    return versement;
  }

  // Annule UN versement précis (docs/data-dictionary.md — jamais une
  // action groupée qui en archive plusieurs sans identification
  // individuelle : une éventuelle sélection multiple resterait un détail
  // d'UI, plusieurs appels distincts, jamais une transaction qui en
  // archive plusieurs d'un coup). Traçabilité garantie par les colonnes
  // d'audit du versement lui-même (updated_at/updated_by/version) —
  // journal_audit n'intervient pas ici, réservé aux accès à une donnée
  // sensible (voir AuditService).
  async annuler(id: string) {
    const [versement] = await this.db.select().from(versements).where(eq(versements.id, id)).limit(1);
    if (!versement) {
      throw new NotFoundException("Versement introuvable");
    }

    const [versementAnnule] = await mettreAJourAvecAudit(
      this.db,
      versements,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!versementAnnule) {
      throw new NotFoundException("Versement introuvable");
    }

    const [paiement] = await this.db.select().from(paiements).where(eq(paiements.id, versement.paiementId)).limit(1);
    if (paiement) {
      await this.recalculerStatutPaiement(versement.paiementId, paiement.montant);
    }

    return versementAnnule;
  }

  private async recalculerStatutPaiement(paiementId: string, montantDu: string): Promise<void> {
    const versementsActifs = await this.db
      .select()
      .from(versements)
      .where(and(eq(versements.paiementId, paiementId), isNull(versements.archivedAt)));
    const montantRecu = calculerMontantRecuTotal(versementsActifs);
    const statut = calculerStatutPaiement(montantDu, montantRecu);
    await mettreAJourAvecAudit(this.db, paiements, paiementId, { statut }, this.requestContext.getUtilisateurId());
  }
}
