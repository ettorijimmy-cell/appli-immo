import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  calculerStatutAppartementApresResiliation,
  peutActiverBail,
  preremplirLoyerBail
} from "core";
import { appartements, baux, mettreAJourAvecAudit, type Database } from "db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateBailDto } from "./dto/create-bail.dto";
import type { ResilierBailDto } from "./dto/resilier-bail.dto";
import type { UpdateBailDto } from "./dto/update-bail.dto";

@Injectable()
export class BauxService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateBailDto) {
    const [appartement] = await this.db
      .select()
      .from(appartements)
      .where(eq(appartements.id, dto.appartementId))
      .limit(1);
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }

    const loyerMensuel = preremplirLoyerBail(dto.loyerMensuel, appartement.loyerReference);

    const [bail] = await this.db
      .insert(baux)
      .values({
        appartementId: dto.appartementId,
        typeBail: dto.typeBail,
        dateDebut: dto.dateDebut,
        dateFin: dto.dateFin,
        loyerMensuel,
        depotGarantie: dto.depotGarantie
      })
      .returning();
    if (!bail) {
      throw new Error("Échec de la création du bail");
    }
    return bail;
  }

  async findAll(appartementId?: string) {
    if (appartementId) {
      return this.db.select().from(baux).where(eq(baux.appartementId, appartementId));
    }
    return this.db.select().from(baux);
  }

  async findById(id: string) {
    const [bail] = await this.db.select().from(baux).where(eq(baux.id, id)).limit(1);
    return bail ?? null;
  }

  async update(id: string, dto: UpdateBailDto) {
    // Champs listés explicitement plutôt qu'un `...dto` : même si un champ
    // `statut` parvenait un jour jusqu'ici (bug ailleurs, contournement du
    // typage), il ne serait jamais écrit — la seule voie pour changer le
    // statut d'un bail reste activer() / resilier() / archive() ci-dessous.
    const [bail] = await mettreAJourAvecAudit(
      this.db,
      baux,
      id,
      {
        typeBail: dto.typeBail,
        dateDebut: dto.dateDebut,
        dateFin: dto.dateFin,
        loyerMensuel: dto.loyerMensuel,
        depotGarantie: dto.depotGarantie
      },
      this.requestContext.getUtilisateurId()
    );
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }
    return bail;
  }

  // Transactionnel : l'activation du bail et le passage de l'appartement à
  // "loue" doivent réussir ou échouer ensemble (docs/backlog.md, Module 3).
  async activer(id: string) {
    return this.db.transaction(async (tx) => {
      const [bail] = await tx.select().from(baux).where(eq(baux.id, id)).limit(1);
      if (!bail) {
        throw new NotFoundException("Bail introuvable");
      }
      if (bail.statut !== "brouillon") {
        throw new ConflictException(
          `Seul un bail en brouillon peut être activé (statut actuel : ${bail.statut}).`
        );
      }

      const [appartement] = await tx
        .select()
        .from(appartements)
        .where(eq(appartements.id, bail.appartementId))
        .limit(1);
      if (!appartement) {
        throw new NotFoundException("Appartement introuvable");
      }

      // Contrôle sur la vraie source de vérité (baux), pas seulement sur le
      // champ miroir appartements.statut : ce dernier reste modifiable à la
      // main (Module 2, ex. correction de saisie) et pourrait sinon être
      // remis à "vacant" pendant qu'un bail est encore réellement actif,
      // permettant d'activer un second bail sur le même appartement.
      const bauxConcurrents = await tx
        .select()
        .from(baux)
        .where(
          and(
            eq(baux.appartementId, bail.appartementId),
            ne(baux.id, id),
            inArray(baux.statut, ["actif", "preavis"])
          )
        );
      if (bauxConcurrents.length > 0) {
        throw new ConflictException(
          "Impossible d'activer ce bail : un autre bail est déjà actif ou en préavis sur cet appartement."
        );
      }

      const verification = peutActiverBail(appartement.statut);
      if (!verification.ok) {
        throw new ConflictException(verification.raison);
      }

      const utilisateurId = this.requestContext.getUtilisateurId();
      const [bailActive] = await mettreAJourAvecAudit(tx, baux, id, { statut: "actif" }, utilisateurId);
      if (!bailActive) {
        throw new Error("Échec de l'activation du bail");
      }

      await mettreAJourAvecAudit(
        tx,
        appartements,
        bail.appartementId,
        { statut: "loue" },
        utilisateurId
      );

      return bailActive;
    });
  }

  // Transactionnel, même principe que activer(). Le nouveau statut de
  // l'appartement est calculé par packages/core : ne repasse à "vacant" que
  // s'il était bien "loue" (garde contre l'écrasement d'un statut modifié
  // manuellement entre-temps, ex. "travaux").
  async resilier(id: string, dto: ResilierBailDto) {
    return this.db.transaction(async (tx) => {
      const [bail] = await tx.select().from(baux).where(eq(baux.id, id)).limit(1);
      if (!bail) {
        throw new NotFoundException("Bail introuvable");
      }
      if (bail.statut !== "actif" && bail.statut !== "preavis") {
        throw new ConflictException(
          `Seul un bail actif ou en préavis peut être résilié (statut actuel : ${bail.statut}).`
        );
      }

      const [appartement] = await tx
        .select()
        .from(appartements)
        .where(eq(appartements.id, bail.appartementId))
        .limit(1);
      if (!appartement) {
        throw new NotFoundException("Appartement introuvable");
      }

      const utilisateurId = this.requestContext.getUtilisateurId();
      const [bailResilie] = await mettreAJourAvecAudit(
        tx,
        baux,
        id,
        { statut: "resilie", dateFin: dto.dateFin },
        utilisateurId
      );
      if (!bailResilie) {
        throw new Error("Échec de la résiliation du bail");
      }

      const nouveauStatutAppartement = calculerStatutAppartementApresResiliation(appartement.statut);
      await mettreAJourAvecAudit(
        tx,
        appartements,
        bail.appartementId,
        { statut: nouveauStatutAppartement },
        utilisateurId
      );

      return bailResilie;
    });
  }

  async archive(id: string) {
    const [bail] = await this.db.select().from(baux).where(eq(baux.id, id)).limit(1);
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }
    if (bail.statut !== "brouillon" && bail.statut !== "resilie") {
      throw new ConflictException(
        `Un bail actif ou en préavis doit d'abord être résilié avant d'être archivé (statut actuel : ${bail.statut}).`
      );
    }

    const [bailArchive] = await mettreAJourAvecAudit(
      this.db,
      baux,
      id,
      { statut: "archive", archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!bailArchive) {
      throw new NotFoundException("Bail introuvable");
    }
    return bailArchive;
  }
}
