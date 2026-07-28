import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  calculerBornesMoisCalendaire,
  calculerMontantEcheanceEntree,
  calculerMontantEcheanceLoyer,
  calculerProrataOccupationPartielle,
  calculerStatutAppartementApresResiliation,
  calculerStatutPaiement,
  montantEnCentimes,
  peutActiverBail,
  preremplirLoyerBail
} from "core";
import { appartements, baux, mettreAJourAvecAudit, paiements, type Database } from "db";
import { and, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
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
        depotGarantie: dto.depotGarantie,
        provisionsCharges: dto.provisionsCharges,
        jourEcheance: dto.jourEcheance
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
        depotGarantie: dto.depotGarantie,
        provisionsCharges: dto.provisionsCharges,
        jourEcheance: dto.jourEcheance
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

      // jour_echeance n'intervient jamais sur la première échéance (voir
      // calculerMontantEcheanceEntree, packages/core) — il reste requis ici
      // uniquement pour ne jamais activer un bail qui ne pourrait plus
      // jamais être facturé une fois le job récurrent du Module 6
      // construit (docs/data-dictionary.md, section baux).
      if (bail.jourEcheance === null) {
        throw new ConflictException(
          "Impossible d'activer ce bail : le jour d'échéance doit être renseigné au préalable."
        );
      }
      if (bail.loyerMensuel === null) {
        throw new ConflictException(
          "Impossible d'activer ce bail : le loyer mensuel doit être renseigné au préalable."
        );
      }

      const utilisateurId = this.requestContext.getUtilisateurId();
      // Posée ici, jamais modifiée ensuite (pas dans UpdateBailDto) — trace
      // historique du moment administratif de l'activation, mais n'entre
      // plus dans aucun calcul financier (docs/data-dictionary.md).
      const dateActivation = new Date().toISOString().slice(0, 10);
      const [bailActive] = await mettreAJourAvecAudit(
        tx,
        baux,
        id,
        { statut: "actif", dateActivation },
        utilisateurId
      );
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

      // Génération des échéances à l'activation (docs/data-dictionary.md,
      // "Décision produit — génération des échéances à l'activation") :
      // seules la caution (si due) et la toute première échéance de loyer
      // sont créées ici, toutes deux exigibles à date_debut — l'entrée
      // réelle dans les lieux, jamais la date d'activation administrative
      // (qui peut lui être largement postérieure). Les échéances suivantes
      // seront produites par le job planifié quotidien du Module 6 —
      // jamais toutes générées d'avance.
      if (bail.depotGarantie && montantEnCentimes(bail.depotGarantie) > 0) {
        await tx.insert(paiements).values({
          bailId: id,
          type: "depot_garantie",
          montant: bail.depotGarantie,
          dateEcheance: bail.dateDebut
        });
      }
      await tx.insert(paiements).values({
        bailId: id,
        type: "loyer",
        montant: calculerMontantEcheanceEntree(bail.loyerMensuel, bail.provisionsCharges, bail.dateDebut),
        dateEcheance: bail.dateDebut
      });

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

      // Prorata de l'échéance de loyer du mois de résiliation
      // (docs/data-dictionary.md, "Décision produit — prorata à la
      // résiliation"). Rien à proratiser sans date de fin explicite
      // (dateFin optionnel dans ResilierBailDto).
      if (dto.dateFin) {
        const { debutMoisInclus, debutMoisSuivantExclusif } = calculerBornesMoisCalendaire(dto.dateFin);
        const [echeanceDuMois] = await tx
          .select()
          .from(paiements)
          .where(
            and(
              eq(paiements.bailId, id),
              eq(paiements.type, "loyer"),
              isNull(paiements.archivedAt),
              gte(paiements.dateEcheance, debutMoisInclus),
              lt(paiements.dateEcheance, debutMoisSuivantExclusif)
            )
          )
          .limit(1);

        if (echeanceDuMois) {
          // Cas A : une échéance couvre déjà ce mois — comportement
          // inchangé. Uniquement si elle n'est pas déjà réglée
          // intégralement, sinon on n'y touche pas (trop-perçu non traité,
          // voir docs/backlog.md, dette technique).
          if (echeanceDuMois.statut === "impaye" || echeanceDuMois.statut === "partiel") {
            const montantProratise = calculerProrataOccupationPartielle(echeanceDuMois.montant, dto.dateFin);
            await mettreAJourAvecAudit(
              tx,
              paiements,
              echeanceDuMois.id,
              {
                montant: montantProratise,
                statut: calculerStatutPaiement(montantProratise, echeanceDuMois.montantPaye)
              },
              utilisateurId
            );
          }
        } else if (bail.loyerMensuel) {
          // Cas B : aucune échéance ne couvre ce mois — ne jamais laisser
          // une période d'occupation sans ligne de paiement
          // correspondante. Toujours depuis le 1er jour du mois de
          // dateFin : le mois de date_debut est exclusivement traité par
          // le Cas A (l'échéance d'entrée, toujours générée pour ce mois
          // précis dès l'activation — voir calculerMontantEcheanceEntree),
          // donc tout mois que le Cas B doit encore combler est
          // nécessairement postérieur, occupé en continu depuis son 1er
          // jour (docs/data-dictionary.md, section baux).
          const montantPlein = calculerMontantEcheanceLoyer(bail.loyerMensuel, bail.provisionsCharges);
          const montantProratise = calculerProrataOccupationPartielle(montantPlein, dto.dateFin);
          if (montantEnCentimes(montantProratise) > 0) {
            await tx.insert(paiements).values({
              bailId: id,
              type: "loyer",
              montant: montantProratise,
              dateEcheance: dto.dateFin
            });
          }
        }
      }

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
