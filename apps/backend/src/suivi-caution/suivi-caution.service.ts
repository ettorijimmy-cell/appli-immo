import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  calculerDateFinEngagementCaution,
  calculerFinEngagementColocation,
  refusDateRemiseBail,
  resoudreLocataireGaranti,
  type FinEngagementColocation
} from "core";
import { bailLocataires, garantRemiseBail, garants, mettreAJourAvecAudit, type Database } from "db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AuditService } from "../audit/audit.service";
import { BailDocumentDocxService, choixDureeDuBail, contexteGarantiesDuBail } from "../bail-document-docx/bail-document-docx.service";
import { dateDuJourParis } from "../common/date-paris";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { DeclarerRemiseBailDto } from "./dto/declarer-remise-bail.dto";

export const MESSAGE_SUIVI_RESERVE_CAUTION =
  "La remise du bail et la fin d'engagement ne concernent qu'une caution personne physique.";
export const MESSAGE_DUREE_BAIL_INDETERMINEE =
  "Fin d'engagement non calculable : caractère familial de la SCI bailleresse non renseigné.";

const CODE_POSTGRES_VIOLATION_UNICITE = "23505";

type GarantRow = typeof garants.$inferSelect;
type RemiseRow = typeof garantRemiseBail.$inferSelect;

export interface DeclarationRemiseBail {
  id: string;
  dateRemise: string;
  mode: RemiseRow["mode"];
  declareeLe: Date;
  declareePar: string;
  archivedAt: Date | null;
}

export interface RemiseBailCaution {
  active: DeclarationRemiseBail | null;
  // Déclarations remplacées par une correction, la plus récente en premier.
  historique: DeclarationRemiseBail[];
}

export interface EngagementCaution {
  // Fin de l'engagement de la caution (même calcul que l'acte, dernier
  // jour inclus) ; null si la durée du bail n'est pas déterminable.
  dateFinEngagement: string | null;
  motifIndisponible: string | null;
  // Colocation (art. 8-1, VI) : le colocataire garanti a une date d'effet
  // de congé sur son lien au bail.
  colocation: (FinEngagementColocation & { dateEffetConge: string }) | null;
}

function codePostgres(erreur: unknown): unknown {
  return typeof erreur === "object" && erreur !== null && "code" in erreur ? (erreur as { code: unknown }).code : undefined;
}

function versDeclaration(ligne: RemiseRow): DeclarationRemiseBail {
  return {
    id: ligne.id,
    dateRemise: ligne.dateRemise,
    mode: ligne.mode,
    declareeLe: ligne.declareeLe,
    declareePar: ligne.declareePar,
    archivedAt: ligne.archivedAt
  };
}

// Suivi d'une caution personne physique après la signature (chantier
// garants, commit 6) :
// - remise d'un exemplaire du bail (loi n° 89-462, art. 22-1), déclarée par
//   le bailleur dans garant_remise_bail ; une correction archive la
//   déclaration active puis en insère une nouvelle, dans une transaction
//   (même modèle que l'entrée papier de l'état des lieux) — jamais d'UPDATE
//   des champs de fond (triggers de la migration 0078) ;
// - fin d'engagement : même date que l'acte de cautionnement, et en
//   colocation les deux dates de l'art. 8-1, VI (remplacement non détecté).
@Injectable()
export class SuiviCautionService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly bailDocumentDocxService: BailDocumentDocxService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService
  ) {}

  async declarerRemiseBail(garantId: string, dto: DeclarerRemiseBailDto): Promise<RemiseBailCaution> {
    const refusDate = refusDateRemiseBail(dto.dateRemise, dateDuJourParis());
    if (refusDate) {
      throw new BadRequestException(refusDate);
    }
    const utilisateurId = this.requestContext.getUtilisateurId();
    const garant = await this.resoudreCaution(garantId);
    if (!utilisateurId || garant.archivedAt !== null) {
      // Refus en cas de doute, comme l'entrée papier : sans utilisateur, la
      // déclaration n'a pas d'auteur. Garant retiré : plus rien à déclarer.
      throw new NotFoundException("Garant introuvable");
    }

    try {
      await this.db.transaction(async (tx) => {
        // Relue dans la transaction : c'est elle qui décide s'il s'agit
        // d'une correction. Deux déclarations simultanées : l'index unique
        // partiel en refuse une (409).
        const [active] = await tx
          .select()
          .from(garantRemiseBail)
          .where(and(eq(garantRemiseBail.garantId, garantId), isNull(garantRemiseBail.archivedAt)));
        if (active) {
          // Archivée AVANT l'insertion (une seule déclaration active).
          await mettreAJourAvecAudit(tx, garantRemiseBail, active.id, { archivedAt: new Date() }, utilisateurId);
        }
        const [nouvelle] = await tx
          .insert(garantRemiseBail)
          .values({
            garantId,
            organisationId: garant.organisationId,
            dateRemise: dto.dateRemise,
            mode: dto.mode,
            declareeLe: new Date(),
            declareePar: utilisateurId,
            updatedBy: utilisateurId
          })
          .returning();
        await this.auditService.logCreation(
          {
            entiteType: "garant_remise_bail",
            entiteId: nouvelle!.id,
            utilisateurId,
            donneesAvant: active ? { id: active.id, dateRemise: active.dateRemise, mode: active.mode } : null,
            donneesApres: { garantId, dateRemise: dto.dateRemise, mode: dto.mode }
          },
          tx
        );
      });
    } catch (erreur) {
      if (codePostgres(erreur) === CODE_POSTGRES_VIOLATION_UNICITE) {
        throw new ConflictException(
          "Une autre déclaration de remise du bail vient d'être enregistrée : rechargez puis réessayez."
        );
      }
      throw erreur;
    }
    return this.lireRemiseBail(garantId);
  }

  async consulterRemiseBail(garantId: string): Promise<RemiseBailCaution> {
    await this.resoudreCaution(garantId);
    return this.lireRemiseBail(garantId);
  }

  async consulterEngagement(garantId: string): Promise<EngagementCaution> {
    const garant = await this.resoudreCaution(garantId);
    const parties = await this.bailDocumentDocxService.chargerPartiesDuBail(garant.bailId);
    const { bail, bienRow, sci } = parties;

    // Même choix de durée que l'acte (meublé : standard, l'acte n'en
    // reçoit pas d'autre depuis le desktop).
    const choixDuree = choixDureeDuBail({ bail, bienRow, sci, regimeDureeMeuble: undefined });

    // Locataire garanti résolu comme pour l'acte ; son lien au bail le plus
    // récent porte la date d'effet du congé (même retiré du bail depuis).
    const garanti = resoudreLocataireGaranti(garant, contexteGarantiesDuBail(parties).locataires);
    let colocation: EngagementCaution["colocation"] = null;
    if (garanti !== null) {
      const [lien] = await this.db
        .select({ dateEffetConge: bailLocataires.dateEffetConge })
        .from(bailLocataires)
        .where(and(eq(bailLocataires.bailId, garant.bailId), eq(bailLocataires.locataireId, garanti.locataireId)))
        .orderBy(desc(bailLocataires.createdAt), desc(bailLocataires.id))
        .limit(1);
      if (lien?.dateEffetConge) {
        colocation = { dateEffetConge: lien.dateEffetConge, ...calculerFinEngagementColocation(lien.dateEffetConge) };
      }
    }

    return {
      dateFinEngagement: choixDuree ? calculerDateFinEngagementCaution(bail.dateDebut, choixDuree) : null,
      motifIndisponible: choixDuree ? null : MESSAGE_DUREE_BAIL_INDETERMINEE,
      colocation
    };
  }

  private async lireRemiseBail(garantId: string): Promise<RemiseBailCaution> {
    const lignes = await this.db
      .select()
      .from(garantRemiseBail)
      .where(eq(garantRemiseBail.garantId, garantId))
      .orderBy(desc(garantRemiseBail.declareeLe), desc(garantRemiseBail.id));
    const active = lignes.find((ligne) => ligne.archivedAt === null);
    return {
      active: active ? versDeclaration(active) : null,
      historique: lignes.filter((ligne) => ligne.archivedAt !== null).map(versDeclaration)
    };
  }

  // Même 404 qu'un garant inexistant pour une autre organisation ; 400 pour
  // un garant qui n'est pas une caution personne physique (Visale).
  private async resoudreCaution(garantId: string): Promise<GarantRow> {
    const [garant] = await this.db.select().from(garants).where(eq(garants.id, garantId)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!garant || (organisationId && garant.organisationId !== organisationId)) {
      throw new NotFoundException("Garant introuvable");
    }
    if (garant.typeGarantie !== "personne_physique") {
      throw new BadRequestException(MESSAGE_SUIVI_RESERVE_CAUTION);
    }
    return garant;
  }
}
