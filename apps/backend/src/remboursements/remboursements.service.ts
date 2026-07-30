import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { calculerMontantRecuTotal, montantEnCentimes } from "core";
import { mettreAJourAvecAudit, paiements, remboursements, versements, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateRemboursementDto } from "./dto/create-remboursement.dto";

@Injectable()
export class RemboursementsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async findAll(bailId?: string) {
    if (bailId) {
      return this.db.select().from(remboursements).where(eq(remboursements.bailId, bailId));
    }
    return this.db.select().from(remboursements);
  }

  // Toujours un acte humain explicite (docs/data-dictionary.md, section
  // "versements & remboursements") : ni resilier() ni aucun autre service
  // ne crée de remboursement seul. Si paiementId est renseigné, valide que
  // la somme des remboursements déjà actifs pour ce paiement + celui-ci ne
  // dépasse JAMAIS le montant réellement reçu sur ce paiement (versements
  // actifs) — rejet strict (ConflictException), sans exception, décision
  // tranchée avec l'utilisateur avant tout code.
  async create(dto: CreateRemboursementDto) {
    if (dto.paiementId) {
      const [paiement] = await this.db.select().from(paiements).where(eq(paiements.id, dto.paiementId)).limit(1);
      if (!paiement) {
        throw new NotFoundException("Paiement introuvable");
      }

      const versementsActifs = await this.db
        .select()
        .from(versements)
        .where(and(eq(versements.paiementId, dto.paiementId), isNull(versements.archivedAt)));
      const montantRecu = calculerMontantRecuTotal(versementsActifs);

      const remboursementsExistants = await this.db
        .select()
        .from(remboursements)
        .where(and(eq(remboursements.paiementId, dto.paiementId), isNull(remboursements.archivedAt)));
      const centimesDejaRembourses = remboursementsExistants.reduce(
        (total, r) => total + montantEnCentimes(r.montantRembourse),
        0
      );

      if (centimesDejaRembourses + montantEnCentimes(dto.montantRembourse) > montantEnCentimes(montantRecu)) {
        throw new ConflictException(
          "Le total des remboursements ne peut pas dépasser le montant réellement reçu sur ce paiement."
        );
      }
    }

    const [remboursement] = await this.db
      .insert(remboursements)
      .values({
        bailId: dto.bailId,
        paiementId: dto.paiementId ?? null,
        type: dto.type,
        montantOrigine: dto.montantOrigine,
        montantRembourse: dto.montantRembourse,
        commentaire: dto.commentaire ?? null,
        dateRemboursement: dto.dateRemboursement,
        mode: dto.mode
      })
      .returning();
    if (!remboursement) {
      throw new Error("Échec de la création du remboursement");
    }
    return remboursement;
  }

  async archive(id: string) {
    const [remboursement] = await mettreAJourAvecAudit(
      this.db,
      remboursements,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!remboursement) {
      throw new NotFoundException("Remboursement introuvable");
    }
    return remboursement;
  }
}
