import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { estTypeResidentiel, type TypeBien } from "core";
import { appartements, baux, bien, mettreAJourAvecAudit, type Database } from "db";
import { and, eq, inArray } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { CreateAppartementDto } from "./dto/create-appartement.dto";
import type { UpdateAppartementDto } from "./dto/update-appartement.dto";

type AppartementRow = typeof appartements.$inferSelect;

// type/nombrePiecesPrincipales/modeChauffage/modeEauChaude/typeEnergie :
// mentions du contrat-type résidentiel (décret n° 2015-587), sans objet
// pour un bien non résidentiel — les 5 sont rejetés si fournis pour un
// bien non résidentiel (audit du 2026-08-27, docs/backlog.md).
const CHAMPS_HABITATION = [
  "type",
  "nombrePiecesPrincipales",
  "modeChauffage",
  "modeEauChaude",
  "typeEnergie"
] as const;

// Sous-ensemble obligatoire à la création pour un bien résidentiel — déjà
// le comportement avant cet audit pour ces 4 champs (CreateAppartementDto
// les exigeait sans condition). typeEnergie en est volontairement exclu :
// aucun écran desktop (NewBienWizard, BienDetailView) ne le collecte
// aujourd'hui, le rendre obligatoire bloquerait toute création résidentielle
// tant que le frontend n'est pas mis à jour — corrige seulement le bug
// signalé (aucun chemin d'écriture), sans nouvelle obligation à la création
// (décision utilisateur, audit du 2026-08-27).
const CHAMPS_HABITATION_REQUIS_A_LA_CREATION = [
  "type",
  "nombrePiecesPrincipales",
  "modeChauffage",
  "modeEauChaude"
] as const;

@Injectable()
export class AppartementsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService
  ) {}

  async create(dto: CreateAppartementDto) {
    const bienType = await this.recupererTypeBien(dto.bienId);

    const champsHabitation: Record<(typeof CHAMPS_HABITATION)[number], unknown> = {
      type: dto.type,
      nombrePiecesPrincipales: dto.nombrePiecesPrincipales,
      modeChauffage: dto.modeChauffage,
      modeEauChaude: dto.modeEauChaude,
      typeEnergie: dto.typeEnergie
    };
    this.validerChampsHabitation(bienType, champsHabitation);

    const [appartement] = await this.db
      .insert(appartements)
      .values({
        bienId: dto.bienId,
        numero: dto.numero,
        type: dto.type,
        surface: dto.surface,
        loyerReference: dto.loyerReference,
        nombrePiecesPrincipales: dto.nombrePiecesPrincipales,
        modeChauffage: dto.modeChauffage,
        modeEauChaude: dto.modeEauChaude,
        typeEnergie: dto.typeEnergie
      })
      .returning();
    if (!appartement) {
      throw new Error("Échec de la création de l'appartement");
    }
    return this.versDto(appartement);
  }

  async findAll(bienId?: string) {
    const lignes = bienId
      ? await this.db.select().from(appartements).where(eq(appartements.bienId, bienId))
      : await this.db.select().from(appartements);
    return lignes.map((appartement) => this.versDto(appartement));
  }

  async findById(id: string) {
    const [appartement] = await this.db
      .select()
      .from(appartements)
      .where(eq(appartements.id, id))
      .limit(1);
    return appartement ? this.versDto(appartement) : null;
  }

  async update(id: string, dto: UpdateAppartementDto) {
    if (dto.statut === "loue") {
      await this.verifierBailActifOuPreavisExiste(id);
    }

    const champsHabitationFournis = CHAMPS_HABITATION.filter((champ) => dto[champ] !== undefined);
    if (champsHabitationFournis.length > 0) {
      const [appartementExistant] = await this.db
        .select({ bienId: appartements.bienId })
        .from(appartements)
        .where(eq(appartements.id, id))
        .limit(1);
      if (!appartementExistant) {
        throw new NotFoundException("Appartement introuvable");
      }
      const bienType = await this.recupererTypeBien(appartementExistant.bienId);
      // Sur update, seuls les champs effectivement fournis sont vérifiés —
      // jamais de blocage sur un champ absent de la requête (contrairement
      // à create()) : un appartement résidentiel déjà créé avant ce
      // durcissement reste modifiable normalement, un champ à la fois.
      if (!estTypeResidentiel(bienType)) {
        throw new BadRequestException(
          `Champs sans objet pour un bien non résidentiel (${bienType}) : ${champsHabitationFournis.join(", ")}.`
        );
      }
    }

    const [appartement] = await mettreAJourAvecAudit(
      this.db,
      appartements,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }
    return this.versDto(appartement as AppartementRow);
  }

  async archive(id: string) {
    const [appartement] = await mettreAJourAvecAudit(
      this.db,
      appartements,
      id,
      { statut: "archive", archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }
    return this.versDto(appartement as AppartementRow);
  }

  private async recupererTypeBien(bienId: string): Promise<TypeBien> {
    const [bienParent] = await this.db.select({ type: bien.type }).from(bien).where(eq(bien.id, bienId)).limit(1);
    if (!bienParent) {
      throw new NotFoundException("Bien introuvable");
    }
    return bienParent.type;
  }

  // Résidentiel : 4 des 5 champs sont obligatoires à la création (voir
  // CHAMPS_HABITATION_REQUIS_A_LA_CREATION), typeEnergie reste optionnel.
  // Non résidentiel : rejet explicite si l'un des 5 est fourni, plutôt
  // qu'un `type=T3` incohérent sur un parking entrant en base par erreur
  // de saisie (décision utilisateur, audit du 2026-08-27).
  private validerChampsHabitation(
    bienType: TypeBien,
    champs: Record<(typeof CHAMPS_HABITATION)[number], unknown>
  ): void {
    if (estTypeResidentiel(bienType)) {
      const manquants = CHAMPS_HABITATION_REQUIS_A_LA_CREATION.filter((champ) => champs[champ] === undefined);
      if (manquants.length > 0) {
        throw new BadRequestException(`Champs obligatoires manquants pour un appartement résidentiel : ${manquants.join(", ")}.`);
      }
      return;
    }
    const fournis = CHAMPS_HABITATION.filter((champ) => champs[champ] !== undefined);
    if (fournis.length > 0) {
      throw new BadRequestException(
        `Champs sans objet pour un bien non résidentiel (${bienType}) : ${fournis.join(", ")}.`
      );
    }
  }

  // Gap 2 — concurrence Module 3 (docs/backlog.md, dette technique) :
  // empêche un appartement "loué fantôme" (statut forcé manuellement sans
  // bail réel derrière) tout en préservant la correction légitime d'une
  // désynchronisation existante — peu importe comment le bail actif/en
  // préavis est arrivé à cet état, seule son existence compte, jamais
  // l'obligation de passer par activer().
  private async verifierBailActifOuPreavisExiste(appartementId: string): Promise<void> {
    const [bail] = await this.db
      .select({ id: baux.id })
      .from(baux)
      .where(and(eq(baux.appartementId, appartementId), inArray(baux.statut, ["actif", "preavis"])))
      .limit(1);
    if (!bail) {
      throw new ConflictException(
        "Impossible de passer cet appartement en 'loué' : aucun bail actif ou en préavis n'existe pour cet appartement."
      );
    }
  }

  // identifiant_fiscal (donnée fiscale nominative, packages/db/src/schema/
  // appartements.ts) n'est ni exposé ici ni réplicable par le Sync Stream
  // appartements (docs/backlog.md, chantier PowerSync) — aucun DTO
  // create/update ne permet de le saisir aujourd'hui, et aucun code
  // frontend n'en dépend en lecture.
  private versDto(appartement: AppartementRow) {
    return {
      id: appartement.id,
      createdAt: appartement.createdAt,
      updatedAt: appartement.updatedAt,
      updatedBy: appartement.updatedBy,
      version: appartement.version,
      archivedAt: appartement.archivedAt,
      bienId: appartement.bienId,
      numero: appartement.numero,
      type: appartement.type,
      surface: appartement.surface,
      loyerReference: appartement.loyerReference,
      nombrePiecesPrincipales: appartement.nombrePiecesPrincipales,
      modeChauffage: appartement.modeChauffage,
      modeEauChaude: appartement.modeEauChaude,
      typeEnergie: appartement.typeEnergie,
      equipementCuisine: appartement.equipementCuisine,
      dependancesAnnexes: appartement.dependancesAnnexes,
      nombreChambres: appartement.nombreChambres,
      nombreSallesDeBain: appartement.nombreSallesDeBain,
      nombreWc: appartement.nombreWc,
      autrePiece1: appartement.autrePiece1,
      autrePiece2: appartement.autrePiece2,
      statut: appartement.statut
    };
  }
}
