import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  calculerBornesMoisCalendaire,
  calculerDecompositionEcheanceEntree,
  calculerMontantEcheanceLoyer,
  calculerMontantRecuTotal,
  calculerProrataOccupationPartielle,
  calculerStatutAppartementApresResiliation,
  calculerStatutPaiement,
  centimesVersMontant,
  montantEnCentimes,
  peutActiverBail,
  preremplirLoyerBail
} from "core";
import { appartements, baux, bien, mettreAJourAvecAudit, paiements, versements, type Database } from "db";
import { and, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateBailDto } from "./dto/create-bail.dto";
import type { ResilierBailDto } from "./dto/resilier-bail.dto";
import type { UpdateBailDto } from "./dto/update-bail.dto";

type BailRow = typeof baux.$inferSelect;

// Fonction pure, exportée séparément de la classe pour rester testable sans
// connexion DB (voir baux.service.spec.ts). Le driver `postgres` (utilisé
// par Drizzle) peuple `code` (SQLSTATE) et `constraint_name` sur les
// erreurs de violation de contrainte — 23505 = unique_violation. On
// vérifie aussi le nom de la contrainte pour ne jamais absorber par erreur
// une violation d'un autre index unique.
export function estViolationIndexBauxActifUnique(erreur: unknown): boolean {
  return (
    erreur instanceof Error &&
    "code" in erreur &&
    (erreur as { code?: unknown }).code === "23505" &&
    "constraint_name" in erreur &&
    (erreur as { constraint_name?: unknown }).constraint_name === "baux_appartement_id_actif_unique"
  );
}

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
        dateSignature: dto.dateSignature,
        loyerMensuel,
        depotGarantie: dto.depotGarantie,
        provisionsCharges: dto.provisionsCharges,
        jourEcheance: dto.jourEcheance
      })
      .returning();
    if (!bail) {
      throw new Error("Échec de la création du bail");
    }
    return this.versDto(bail);
  }

  // baux n'a pas de colonne organisationId directe : le scoping passe par
  // une double jointure baux -> appartements -> bien (bien.organisationId),
  // même chaîne que GarantsService.create() pour résoudre l'organisation
  // depuis un bail.
  async findAll(appartementId?: string) {
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const conditions = [
        eq(bien.organisationId, organisationId),
        ...(appartementId ? [eq(baux.appartementId, appartementId)] : [])
      ];
      const rows = await this.db
        .select({ bail: baux })
        .from(baux)
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(...conditions));
      return rows.map((row) => this.versDto(row.bail));
    }
    const lignes = appartementId
      ? await this.db.select().from(baux).where(eq(baux.appartementId, appartementId))
      : await this.db.select().from(baux);
    return lignes.map((bail) => this.versDto(bail));
  }

  // Contrôle d'appartenance (Sous-commit 5c, chantier scoping
  // multi-organisation, 2026-09-18) : baux n'a pas de colonne
  // organisationId directe (voir findAll() ci-dessus), le contrôle passe
  // par une double jointure appartements -> bien. Même message que
  // "n'existe pas", aucune différence observable. Skip si organisationId
  // absent (hors contexte HTTP).
  async findById(id: string) {
    const [bail] = await this.db.select().from(baux).where(eq(baux.id, id)).limit(1);
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
        .where(and(eq(baux.id, id), eq(bien.organisationId, organisationId)))
        .limit(1);
      if (!ligne) {
        throw new NotFoundException("Bail introuvable");
      }
    }
    return this.versDto(bail);
  }

  async update(id: string, dto: UpdateBailDto) {
    // date_debut devient figée dès qu'un bail sort de `brouillon` — même
    // principe que date_activation, jamais modifiable après coup
    // (docs/data-dictionary.md, section baux). Sans cette règle, le job
    // récurrent (Module 6) pourrait sauter silencieusement l'échéance du
    // mois courant si date_debut est repoussée après activation.
    if (dto.dateDebut !== undefined) {
      const [bailExistant] = await this.db.select().from(baux).where(eq(baux.id, id)).limit(1);
      if (!bailExistant) {
        throw new NotFoundException("Bail introuvable");
      }
      if (bailExistant.statut !== "brouillon") {
        throw new ConflictException(
          "Impossible de modifier la date de début d'un bail qui n'est plus en brouillon."
        );
      }
    }

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
        dateSignature: dto.dateSignature,
        loyerMensuel: dto.loyerMensuel,
        depotGarantie: dto.depotGarantie,
        provisionsCharges: dto.provisionsCharges,
        jourEcheance: dto.jourEcheance,
        travauxRealises: dto.travauxRealises,
        honorairesBailleur: dto.honorairesBailleur,
        honorairesLocataire: dto.honorairesLocataire,
        trimestreReferenceRevision: dto.trimestreReferenceRevision
      },
      this.requestContext.getUtilisateurId()
    );
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }
    return this.versDto(bail as BailRow);
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
      // calculerDecompositionEcheanceEntree, packages/core) — il reste
      // requis ici uniquement pour ne jamais activer un bail qui ne pourrait plus
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
      // La pré-vérification bauxConcurrents ci-dessus couvre le cas normal
      // (séquentiel), mais ne protège pas contre une vraie course entre deux
      // appels concurrents à activer() qui passeraient tous les deux la
      // lecture avant qu'aucun ne committe (docs/backlog.md, dette
      // technique Module 3). L'index unique partiel
      // baux_appartement_id_actif_unique (packages/db/src/schema/baux.ts)
      // est la garantie réelle : Postgres sérialise les écritures
      // concurrentes au niveau de l'index B-tree lui-même, indépendamment
      // de tout verrou applicatif. Ce catch ne fait que traduire la
      // violation en erreur métier propre plutôt que de laisser remonter
      // une erreur SQL brute à l'UI.
      let bailActive: BailRow | undefined;
      try {
        const resultat = await mettreAJourAvecAudit(
          tx,
          baux,
          id,
          { statut: "actif", dateActivation },
          utilisateurId
        );
        bailActive = resultat[0] as BailRow | undefined;
      } catch (erreur) {
        if (estViolationIndexBauxActifUnique(erreur)) {
          throw new ConflictException(
            "Impossible d'activer ce bail : un autre bail est déjà actif ou en préavis sur cet appartement."
          );
        }
        throw erreur;
      }
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
      // loyerHorsCharges/charges FIGÉS dès la création, même principe que
      // AlertesJobService.genererEcheancesRecurrentes (packages/db/src/
      // schema/paiements.ts) — sans eux, validerCompletudeGenerationQuittance
      // bloquerait systématiquement la quittance du premier mois. Dérivés
      // via calculerDecompositionEcheanceEntree (packages/core) : charges
      // proratisé, loyerHorsCharges = montant - charges (jamais proratisé
      // indépendamment, voir sa documentation).
      const decompositionEntree = calculerDecompositionEcheanceEntree(
        bail.loyerMensuel,
        bail.provisionsCharges,
        bail.dateDebut
      );
      await tx.insert(paiements).values({
        bailId: id,
        type: "loyer",
        montant: decompositionEntree.montant,
        dateEcheance: bail.dateDebut,
        loyerHorsCharges: decompositionEntree.loyerHorsCharges,
        charges: decompositionEntree.charges
      });

      return this.versDto(bailActive as BailRow);
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

      // date_debut est le vrai début d'occupation (jamais date_activation,
      // purement administrative et absente de tout calcul financier — voir
      // activer() ci-dessus). Sans ce garde, une dateFin antérieure à
      // date_debut laissait calculerProrataOccupationPartielle ramener
      // silencieusement le nombre de jours occupés à 0 (ligne à 0,00 € en
      // Cas A, aucune ligne en Cas B) au lieu de rejeter explicitement une
      // résiliation chronologiquement incohérente (docs/backlog.md, dette
      // technique — corrigé).
      if (dto.dateFin && dto.dateFin < bail.dateDebut) {
        throw new ConflictException(
          "La date de fin ne peut pas précéder la date de début du bail."
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
      // dateResiliation : posée une seule fois ici, jamais retouchée ensuite
      // (pas dans UpdateBailDto, et resilier() rejette déjà toute nouvelle
      // résiliation via le garde-fou de statut ci-dessus). Timestamp exact
      // de la transition, distinct de dateFin (date métier de fin
      // d'occupation, parfois identique entre plusieurs baux) — sert à
      // départager sans ambiguïté plusieurs baux résiliés sur un même
      // appartement (docs/data-dictionary.md).
      const [bailResilie] = await mettreAJourAvecAudit(
        tx,
        baux,
        id,
        { statut: "resilie", dateFin: dto.dateFin, dateResiliation: new Date() },
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

      // Exposé dans la réponse si un trop-perçu est détecté ci-dessous
      // (Cas A uniquement) — jamais écrit en base ici (docs/data-dictionary.md,
      // section "versements & remboursements").
      let tropPercu: { paiementId: string; montant: string } | null = null;

      // Prorata de l'échéance de loyer du mois de résiliation
      // (docs/data-dictionary.md, "Décision produit — prorata à la
      // résiliation"). Rien à proratiser sans date de fin explicite
      // (dateFin optionnel dans ResilierBailDto) ni sans loyer renseigné
      // (toujours vrai en pratique pour un bail actif/préavis — activer()
      // l'exige déjà — mais gardé explicite plutôt que supposé).
      if (dto.dateFin && bail.loyerMensuel) {
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

        // Montant calculé une seule fois, toujours depuis le loyer/les
        // provisions du bail — jamais depuis une échéance existante — et
        // toujours avec dateDebut en repère de début d'occupation.
        // dateDebut ne compte que si son mois calendaire est le MÊME que
        // celui de dateFin (voir calculerProrataOccupationPartielle) :
        // sinon le mois est occupé depuis son 1er jour, comme avant.
        // Corrige un bug réel découvert par financial-logic-reviewer lors
        // de ce même correctif : l'ancien Cas A reproratisait
        // `echeanceDuMois.montant`, qui pouvait déjà être partiel (échéance
        // d'entrée) si la résiliation tombe dans le même mois calendaire
        // que dateDebut — double-décote silencieuse (docs/backlog.md,
        // dette technique).
        const montantPlein = calculerMontantEcheanceLoyer(bail.loyerMensuel, bail.provisionsCharges);
        const montantProratise = calculerProrataOccupationPartielle(montantPlein, dto.dateFin, bail.dateDebut);

        if (echeanceDuMois) {
          // Cas A : une échéance couvre déjà ce mois. Le statut est
          // toujours recalculé depuis les versements ACTIFS (docs/data-
          // dictionary.md, section "versements & remboursements"), jamais
          // depuis un unique montant_paye.
          const versementsActifs = await tx
            .select()
            .from(versements)
            .where(and(eq(versements.paiementId, echeanceDuMois.id), isNull(versements.archivedAt)));
          const montantRecu = calculerMontantRecuTotal(versementsActifs);

          // Le champ `montant` en base n'est mis à jour que si l'échéance
          // n'est pas déjà réglée intégralement (trop-perçu non traité par
          // CE chemin précis — voir juste après — docs/backlog.md, dette
          // technique) : sinon, le montant stocké reste sciemment
          // inchangé.
          if (echeanceDuMois.statut === "impaye" || echeanceDuMois.statut === "partiel") {
            await mettreAJourAvecAudit(
              tx,
              paiements,
              echeanceDuMois.id,
              {
                montant: montantProratise,
                statut: calculerStatutPaiement(montantProratise, montantRecu)
              },
              utilisateurId
            );
          }

          // Trop-perçu (docs/data-dictionary.md, docs/backlog.md, dette
          // technique) : toujours comparé au montant VRAIMENT dû
          // (montantProratise), que le champ stocké ait été mis à jour ou
          // non ci-dessus — les deux scénarios documentés du trop-perçu
          // (échéance déjà payée intégralement, ou partiel dépassant le
          // nouveau prorata) sont ainsi détectés de la même façon. Signalé
          // seulement, jamais créé automatiquement en `remboursements` —
          // un acte humain explicite reste requis
          // (RemboursementsService.create()), cohérent avec la règle
          // "jamais d'automatisation silencieuse" déjà appliquée au
          // rapprochement et aux alertes.
          const centimesTropPercu = montantEnCentimes(montantRecu) - montantEnCentimes(montantProratise);
          if (centimesTropPercu > 0) {
            tropPercu = { paiementId: echeanceDuMois.id, montant: centimesVersMontant(centimesTropPercu) };
          }
        } else {
          // Cas B : aucune échéance ne couvre ce mois — ne jamais laisser
          // une période d'occupation sans ligne de paiement correspondante.
          // Jamais de trop-perçu possible ici : une échéance nouvellement
          // créée n'a par construction aucun versement préexistant.
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

      const bailResilieDto = this.versDto(bailResilie as BailRow);
      return {
        id: bailResilieDto.id,
        createdAt: bailResilieDto.createdAt,
        updatedAt: bailResilieDto.updatedAt,
        updatedBy: bailResilieDto.updatedBy,
        version: bailResilieDto.version,
        archivedAt: bailResilieDto.archivedAt,
        appartementId: bailResilieDto.appartementId,
        typeBail: bailResilieDto.typeBail,
        statut: bailResilieDto.statut,
        loyerMensuel: bailResilieDto.loyerMensuel,
        depotGarantie: bailResilieDto.depotGarantie,
        provisionsCharges: bailResilieDto.provisionsCharges,
        jourEcheance: bailResilieDto.jourEcheance,
        dateDebut: bailResilieDto.dateDebut,
        dateFin: bailResilieDto.dateFin,
        dateActivation: bailResilieDto.dateActivation,
        dateSignature: bailResilieDto.dateSignature,
        dateResiliation: bailResilieDto.dateResiliation,
        travauxRealises: bailResilieDto.travauxRealises,
        honorairesBailleur: bailResilieDto.honorairesBailleur,
        honorairesLocataire: bailResilieDto.honorairesLocataire,
        tropPercu
      };
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
    return this.versDto(bailArchive as BailRow);
  }

  private versDto(bail: BailRow) {
    return {
      id: bail.id,
      createdAt: bail.createdAt,
      updatedAt: bail.updatedAt,
      updatedBy: bail.updatedBy,
      version: bail.version,
      archivedAt: bail.archivedAt,
      appartementId: bail.appartementId,
      typeBail: bail.typeBail,
      statut: bail.statut,
      loyerMensuel: bail.loyerMensuel,
      depotGarantie: bail.depotGarantie,
      provisionsCharges: bail.provisionsCharges,
      jourEcheance: bail.jourEcheance,
      dateDebut: bail.dateDebut,
      dateFin: bail.dateFin,
      dateActivation: bail.dateActivation,
      dateSignature: bail.dateSignature,
      dateResiliation: bail.dateResiliation,
      travauxRealises: bail.travauxRealises,
      honorairesBailleur: bail.honorairesBailleur,
      honorairesLocataire: bail.honorairesLocataire,
      trimestreReferenceRevision: bail.trimestreReferenceRevision
    };
  }
}
