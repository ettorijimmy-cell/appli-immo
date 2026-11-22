import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  calculerDecompositionEcheanceEntree,
  calculerEcheanceMoisFinACreer,
  calculerResteARembourser,
  calculerStatutAppartementApresResiliation,
  calculerTropPercuTotalResiliation,
  centimesVersMontant,
  classerEcheancesParRapportAFin,
  deciderEcheanceApresFin,
  estDateIsoValide,
  montantEnCentimes,
  peutActiverBail,
  preremplirLoyerBail,
  recalculerEcheanceMoisFin,
  refusDateFinResiliation,
  refusDateFinResiliationApresPreavis,
  type DecisionEcheanceApresFin
} from "core";
import {
  appartements,
  bailPreavis,
  baux,
  bien,
  mettreAJourAvecAudit,
  paiements,
  remboursements,
  versements,
  type Database
} from "db";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { dateDuJourParis } from "../common/date-paris";
import { archiverFiche, exigerNonArchiveePourArchiver, exigerNonArchiveePourModifier } from "../common/fiche-archivee";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateBailDto } from "./dto/create-bail.dto";
import {
  MESSAGE_DATE_FIN_RESILIATION_INVALIDE,
  MESSAGE_DATE_FIN_RESILIATION_OBLIGATOIRE,
  type ResilierBailDto
} from "./dto/resilier-bail.dto";
import type { UpdateBailDto } from "./dto/update-bail.dto";

type BailRow = typeof baux.$inferSelect;

// Échéance de loyer d'un mois après la date de fin, gardée à la
// résiliation parce qu'elle a au moins un versement actif : tout ce qui a
// été reçu est un trop-perçu signalé (réponse de resilier()).
export interface EcheanceConserveeApresFin {
  paiementId: string;
  dateEcheance: string;
  montant: string;
  tropPercu: string;
  // Trop-perçu moins les remboursements déjà saisis sur ce paiement.
  resteARembourser: string;
}

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

  // Contrôle d'appartenance sur dto.appartementId (Priorité E3, chantier
  // scoping multi-organisation, Catégorie E, 2026-09-19) : n'était vérifié
  // que pour son existence — sans colonne organisationId propre sur baux,
  // un appartementId d'une autre organisation faisait apparaître le bail
  // créé (loyer, dates, dépôt de garantie) directement dans le dossier de
  // l'organisation propriétaire de l'appartement. Filtre ajouté à la même
  // requête déjà exécutée pour récupérer loyerReference, plutôt qu'une
  // requête séparée.
  async create(dto: CreateBailDto) {
    const organisationId = this.requestContext.getOrganisationId();
    const [ligne] = await this.db
      .select({ appartement: appartements })
      .from(appartements)
      .innerJoin(bien, eq(bien.id, appartements.bienId))
      .where(and(eq(appartements.id, dto.appartementId), ...(organisationId ? [eq(bien.organisationId, organisationId)] : [])))
      .limit(1);
    if (!ligne) {
      throw new NotFoundException("Appartement introuvable");
    }
    const appartement = ligne.appartement;

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
        jourEcheance: dto.jourEcheance,
        assuranceLoyersImpayes: dto.assuranceLoyersImpayes
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
    // Contrôle d'appartenance AVANT toute lecture/écriture (Priorité 3b,
    // Catégorie C, chantier scoping multi-organisation, 2026-09-19) :
    // réutilise verifierAppartenanceBail() (Priorité 2), déjà partagée par
    // activer()/resilier().
    await this.verifierAppartenanceBail(id);

    // Contrôles et écriture dans UNE transaction qui verrouille d'abord la
    // ligne du bail (SELECT … FOR UPDATE) — même verrou que le job,
    // resilier() et PreavisService (revue du commit 3b) : sans lui, une
    // déclaration de préavis pouvait s'intercaler entre la lecture du
    // statut et l'écriture de date_fin, laissant baux.date_fin et le
    // préavis actif en désaccord.
    return this.db.transaction(async (tx) => {
      const [bailExistant] = await tx.select().from(baux).where(eq(baux.id, id)).limit(1).for("update");
      if (!bailExistant) {
        throw new NotFoundException("Bail introuvable");
      }

      // Bail archivé : plus aucune modification (petites suites, décision 4
      // du 2026-11-22). Lu sous le verrou FOR UPDATE ci-dessus : un
      // archivage concurrent attend la fin de cette transaction, ou
      // l'inverse.
      exigerNonArchiveePourModifier(bailExistant);

      // Vrai préavis (décision 12 du 2026-11-15) : la date de fin d'un bail
      // en préavis est celle du préavis ; elle ne se modifie que par
      // l'action de préavis (corriger ou annuler), qui réaligne les
      // échéances. Les autres champs restent modifiables.
      if (dto.dateFin !== undefined && bailExistant.statut === "preavis") {
        throw new ConflictException(
          "Ce bail est en préavis : sa date de fin se modifie depuis le préavis (corriger ou annuler le préavis)."
        );
      }

      // date_debut devient figée dès qu'un bail sort de `brouillon` — même
      // principe que date_activation, jamais modifiable après coup
      // (docs/data-dictionary.md, section baux). Sans cette règle, le job
      // récurrent (Module 6) pourrait sauter silencieusement l'échéance du
      // mois courant si date_debut est repoussée après activation.
      if (dto.dateDebut !== undefined && bailExistant.statut !== "brouillon") {
        throw new ConflictException(
          "Impossible de modifier la date de début d'un bail qui n'est plus en brouillon."
        );
      }

      // Champs listés explicitement plutôt qu'un `...dto` : même si un champ
      // `statut` parvenait un jour jusqu'ici (bug ailleurs, contournement du
      // typage), il ne serait jamais écrit — la seule voie pour changer le
      // statut d'un bail reste activer() / resilier() / archive() et le
      // préavis.
      const [bail] = await mettreAJourAvecAudit(
        tx,
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
          trimestreReferenceRevision: dto.trimestreReferenceRevision,
          assuranceLoyersImpayes: dto.assuranceLoyersImpayes
        },
        this.requestContext.getUtilisateurId()
      );
      if (!bail) {
        throw new NotFoundException("Bail introuvable");
      }
      return this.versDto(bail as BailRow);
    });
  }

  // Transactionnel : l'activation du bail et le passage de l'appartement à
  // "loue" doivent réussir ou échouer ensemble (docs/backlog.md, Module 3).
  async activer(id: string) {
    // Contrôle d'appartenance AVANT l'ouverture de la transaction (Priorité 2,
    // Catégorie C, chantier scoping multi-organisation, 2026-09-19) : avant
    // toute lecture d'appartement, toute création de paiements (caution,
    // échéance d'entrée), toute modification du statut de l'appartement.
    await this.verifierAppartenanceBail(id);
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
      // Loyer strictement positif (petites suites, décision 3). Le DTO le
      // refuse déjà à la saisie, mais create() pré-remplit le loyer depuis
      // appartements.loyer_reference (>= 0) : seule l'activation, avant
      // toute échéance, ferme ce chemin — et couvre une ancienne donnée.
      if (montantEnCentimes(bail.loyerMensuel) <= 0) {
        throw new ConflictException("Impossible d'activer ce bail : le loyer mensuel doit être supérieur à 0 €.");
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
  //
  // Clôture financière (chantier financier de la résiliation, décisions 4
  // à 6 du 2026-11-14 — calculs purs dans packages/core,
  // cloture-financiere-resiliation.ts) : date de fin obligatoire ; mois de
  // fin au prorata (Cas A/B, décomposition comprise) ; échéances de loyer
  // d'un mois après la fin archivées si aucun versement actif, sinon
  // conservées avec leur trop-perçu signalé. Jamais de suppression, jamais
  // de remboursement automatique.
  async resilier(id: string, dto: ResilierBailDto) {
    // Contrôle d'appartenance AVANT l'ouverture de la transaction (Priorité 2,
    // Catégorie C, chantier scoping multi-organisation, 2026-09-19) : avant
    // toute lecture d'appartement, toute création/modification de paiements
    // (prorata), toute modification du statut de l'appartement.
    await this.verifierAppartenanceBail(id);

    // Revérifié ici (ResilierBailDto le refuse déjà en HTTP) : un appel
    // direct au service ne doit jamais résilier sans date de fin.
    if (!dto.dateFin) {
      throw new BadRequestException(MESSAGE_DATE_FIN_RESILIATION_OBLIGATOIRE);
    }
    if (!estDateIsoValide(dto.dateFin)) {
      throw new BadRequestException(MESSAGE_DATE_FIN_RESILIATION_INVALIDE);
    }
    const dateFin = dto.dateFin;

    return this.db.transaction(async (tx) => {
      // Verrou de la ligne du bail (FOR UPDATE) jusqu'à la fin de la
      // transaction : le job de génération des échéances
      // (AlertesJobService.genererEcheancesRecurrentes) prend le même
      // verrou avant d'insérer. Soit il insère avant (son échéance est
      // alors lue et traitée ci-dessous), soit il attend la fin de cette
      // transaction, relit le bail, le voit « resilie » et n'insère rien.
      const [bail] = await tx.select().from(baux).where(eq(baux.id, id)).limit(1).for("update");
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
      // activer() ci-dessus).
      if (dateFin < bail.dateDebut) {
        throw new ConflictException(
          "La date de fin ne peut pas précéder la date de début du bail."
        );
      }

      // Date de fin dans le futur refusée (chantier archivage, décision 16
      // du 2026-11-13 — voir refusDateFinResiliation, packages/core) : le
      // bail passerait aussitôt en « resilie », le job cesserait de générer
      // les échéances et les mois d'occupation restants ne seraient jamais
      // facturés. « Aujourd'hui » = date du jour à Paris.
      const refusDateFuture = refusDateFinResiliation(dateFin, dateDuJourParis());
      if (refusDateFuture) {
        throw new ConflictException(refusDateFuture);
      }

      // Vrai préavis (décision 10 du 2026-11-15) : un bail en préavis se
      // résilie au plus tard à la date de fin du préavis — au-delà,
      // l'occupation relève d'une indemnité d'occupation, gérée à part. Le
      // préavis actif est lu sous le même verrou ; il sera archivé avec le
      // motif « resilie » plus bas, dans cette transaction.
      const [preavisActif] =
        bail.statut === "preavis"
          ? await tx
              .select()
              .from(bailPreavis)
              .where(and(eq(bailPreavis.bailId, id), isNull(bailPreavis.archivedAt)))
          : [];
      // Préavis incohérent (aucune ligne active, ou date de fin du bail
      // différente de celle du préavis) : refus plutôt qu'une résiliation
      // sans limite (revue du commit 3b). Cet état n'apparaît par aucun
      // chemin normal (la déclaration écrit les deux ensemble) ; il se
      // répare à la main.
      if (bail.statut === "preavis" && (!preavisActif || preavisActif.dateFin !== bail.dateFin)) {
        throw new ConflictException(
          "Le préavis de ce bail est incohérent (date de fin du bail différente de celle du préavis, ou préavis introuvable) : il doit être corrigé avant de résilier."
        );
      }
      const refusApresPreavis = refusDateFinResiliationApresPreavis(dateFin, preavisActif?.dateFin ?? null);
      if (refusApresPreavis) {
        throw new ConflictException(refusApresPreavis);
      }

      const [appartement] = await tx
        .select()
        .from(appartements)
        .where(eq(appartements.id, bail.appartementId))
        .limit(1);
      if (!appartement) {
        throw new NotFoundException("Appartement introuvable");
      }

      // Échéances de loyer non archivées du bail, classées par rapport au
      // mois de fin (selon le mois de date_echeance), lues AVANT toute
      // écriture : une incohérence (deux échéances le mois de fin) annule
      // la résiliation sans rien avoir modifié.
      const echeancesLoyer = await tx
        .select()
        .from(paiements)
        .where(and(eq(paiements.bailId, id), eq(paiements.type, "loyer"), isNull(paiements.archivedAt)));
      const classees = classerEcheancesParRapportAFin(echeancesLoyer, dateFin);
      if (classees.moisFin.length > 1) {
        throw new ConflictException(
          `Plusieurs échéances de loyer (${classees.moisFin.length}) couvrent le mois de la date de fin. Gardez-en une seule (archivez les autres depuis Finances) avant de résilier.`
        );
      }

      const idsAVerifier = [...classees.moisFin, ...classees.apresMoisFin].map((echeance) => echeance.id);
      const versementsLus =
        idsAVerifier.length > 0
          ? await tx.select().from(versements).where(inArray(versements.paiementId, idsAVerifier))
          : [];
      const versementsDe = (paiementId: string) => versementsLus.filter((v) => v.paiementId === paiementId);
      // Remboursements déjà saisis sur ces paiements (revue
      // financial-logic-reviewer du commit 2) : en attendant le déploiement,
      // la consigne est de rembourser une échéance payée après la fin ; la
      // réponse doit alors dire ce qui RESTE à rembourser, comme le tableau
      // de bord (calculerResteARembourser, paiement par paiement).
      const remboursementsLus =
        idsAVerifier.length > 0
          ? await tx.select().from(remboursements).where(inArray(remboursements.paiementId, idsAVerifier))
          : [];
      const resteARembourserSur = (paiementId: string, tropPercuPaiement: string) =>
        calculerResteARembourser(
          tropPercuPaiement,
          remboursementsLus.filter((r) => r.paiementId === paiementId)
        );

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
        { statut: "resilie", dateFin, dateResiliation: new Date() },
        utilisateurId
      );
      if (!bailResilie) {
        throw new Error("Échec de la résiliation du bail");
      }

      if (preavisActif) {
        await mettreAJourAvecAudit(
          tx,
          bailPreavis,
          preavisActif.id,
          { archivedAt: new Date(), motifFin: "resilie" },
          utilisateurId
        );
      }

      const nouveauStatutAppartement = calculerStatutAppartementApresResiliation(appartement.statut);
      await mettreAJourAvecAudit(
        tx,
        appartements,
        bail.appartementId,
        { statut: nouveauStatutAppartement },
        utilisateurId
      );

      // Mois de fin. Rien à proratiser sans loyer renseigné (toujours vrai
      // en pratique pour un bail actif/préavis — activer() l'exige — mais
      // gardé explicite plutôt que supposé).
      let tropPercu: { paiementId: string; montant: string } | null = null;
      let tropPercuMoisFin: string | null = null;
      let centimesResteARembourser = 0;
      if (bail.loyerMensuel) {
        const bailCloture = {
          loyerMensuel: bail.loyerMensuel,
          provisionsCharges: bail.provisionsCharges,
          dateDebut: bail.dateDebut
        };
        const [echeanceDuMois] = classees.moisFin;
        if (echeanceDuMois) {
          // Cas A : montant, décomposition et statut recalculés si
          // l'échéance est impayée ou partielle ; payée, elle reste telle
          // quelle. Trop-perçu toujours comparé au prorata, signalé
          // seulement (un remboursement reste un acte humain).
          const resultat = recalculerEcheanceMoisFin(
            { statut: echeanceDuMois.statut, versements: versementsDe(echeanceDuMois.id) },
            bailCloture,
            dateFin
          );
          if (resultat.miseAJour) {
            const { montant, loyerHorsCharges, charges, statut } = resultat.miseAJour;
            await mettreAJourAvecAudit(
              tx,
              paiements,
              echeanceDuMois.id,
              { montant, loyerHorsCharges, charges, statut },
              utilisateurId
            );
          }
          tropPercuMoisFin = resultat.tropPercu;
          centimesResteARembourser += montantEnCentimes(resteARembourserSur(echeanceDuMois.id, resultat.tropPercu));
          if (montantEnCentimes(resultat.tropPercu) > 0) {
            tropPercu = { paiementId: echeanceDuMois.id, montant: resultat.tropPercu };
          }
        } else {
          // Cas B : aucune échéance ne couvre ce mois — ne jamais laisser
          // une période d'occupation sans ligne de paiement. Décomposition
          // renseignée (quittance et régularisation des charges en ont
          // besoin). Rien n'est créé si le prorata est nul.
          const aCreer = calculerEcheanceMoisFinACreer(bailCloture, dateFin);
          if (aCreer) {
            await tx.insert(paiements).values({
              bailId: id,
              type: "loyer",
              montant: aCreer.montant,
              loyerHorsCharges: aCreer.loyerHorsCharges,
              charges: aCreer.charges,
              dateEcheance: dateFin
            });
          }
        }
      }

      // Échéances d'un mois strictement après le mois de fin : le mois
      // n'est pas dû. Sans versement actif : archivée (même écriture que
      // PaiementsService.archive(), qui n'a ici aucun versement actif à
      // archiver en cascade). Avec au moins un versement actif : conservée
      // telle quelle, tout ce qui a été reçu est un trop-perçu signalé.
      let echeancesArchivees = 0;
      const echeancesConservees: EcheanceConserveeApresFin[] = [];
      const decisionsApresFin: DecisionEcheanceApresFin[] = [];
      for (const echeance of classees.apresMoisFin) {
        const decision = deciderEcheanceApresFin(versementsDe(echeance.id));
        decisionsApresFin.push(decision);
        if (decision.decision === "archiver") {
          await mettreAJourAvecAudit(tx, paiements, echeance.id, { archivedAt: new Date() }, utilisateurId);
          echeancesArchivees += 1;
        } else {
          const resteARembourser = resteARembourserSur(echeance.id, decision.tropPercu);
          centimesResteARembourser += montantEnCentimes(resteARembourser);
          echeancesConservees.push({
            paiementId: echeance.id,
            dateEcheance: echeance.dateEcheance,
            montant: echeance.montant,
            tropPercu: decision.tropPercu,
            resteARembourser
          });
        }
      }
      // Brut (tout ce qui a été reçu en trop) et net (après les
      // remboursements déjà saisis) : le desktop affiche le net.
      const tropPercuTotal = calculerTropPercuTotalResiliation(tropPercuMoisFin, decisionsApresFin);
      const resteARembourserTotal = centimesVersMontant(centimesResteARembourser);

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
        // Trop-perçu du seul mois de fin (forme inchangée), puis la clôture
        // des mois suivants et le total à rembourser au locataire.
        tropPercu,
        echeancesArchivees,
        echeancesConservees,
        tropPercuTotal,
        resteARembourserTotal
      };
    });
  }

  async archive(id: string) {
    // Contrôle d'appartenance AVANT toute lecture/écriture (Priorité 3b,
    // Catégorie C, chantier scoping multi-organisation, 2026-09-19).
    await this.verifierAppartenanceBail(id);

    const [bail] = await this.db.select().from(baux).where(eq(baux.id, id)).limit(1);
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }
    // Déjà archivé : 409 « Déjà archivé le … » avant le refus de statut
    // (petites suites, décision 4 du 2026-11-22).
    exigerNonArchiveePourArchiver(bail);
    if (bail.statut !== "brouillon" && bail.statut !== "resilie") {
      throw new ConflictException(
        `Un bail actif ou en préavis doit d'abord être résilié avant d'être archivé (statut actuel : ${bail.statut}).`
      );
    }

    // Condition `archived_at IS NULL` dans l'UPDATE : deux archivages
    // simultanés ne réussissent pas tous les deux.
    const bailArchive = await archiverFiche(
      this.db,
      baux,
      id,
      { statut: "archive" },
      this.requestContext.getUtilisateurId(),
      "Bail introuvable"
    );
    return this.versDto(bailArchive as BailRow);
  }

  // Contrôle d'appartenance (Priorité 2, Catégorie C, chantier scoping
  // multi-organisation, 2026-09-19) : baux n'a pas de colonne organisationId
  // directe (voir findById() plus haut, même jointure appartements -> bien).
  // Utilisé par activer()/resilier() (avant l'ouverture de leur transaction
  // respective) et, depuis Priorité 3b, par update()/archive() — même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP) : dans ce cas, le `!bail`
  // déjà présent dans chaque appelant continue de couvrir le cas "id
  // inexistant".
  private async verifierAppartenanceBail(id: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
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
      trimestreReferenceRevision: bail.trimestreReferenceRevision,
      assuranceLoyersImpayes: bail.assuranceLoyersImpayes
    };
  }
}
