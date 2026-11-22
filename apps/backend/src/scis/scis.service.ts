import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { creerRattachementProprietaire } from "core";
import { appartements, baux, bien, organisationSci, scis, type Database } from "db";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { messageBauxActifsSci, messageBiensNonArchives } from "../common/refus-archivage-parent";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateSciDto } from "./dto/create-sci.dto";
import type { UpdateSciDto } from "./dto/update-sci.dto";
import { archiverFiche, exigerNonArchiveePourArchiver, exigerNonArchiveePourModifier, modifierFiche } from "../common/fiche-archivee";

type SciRow = typeof scis.$inferSelect;

@Injectable()
export class ScisService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly requestContext: RequestContextService
  ) {}

  async create(userId: string, dto: CreateSciDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    return this.db.transaction(async (tx) => {
      const [sci] = await tx
        .insert(scis)
        .values({
          nom: dto.nom,
          regimeFiscal: dto.regimeFiscal,
          formeJuridique: dto.formeJuridique,
          siret: dto.siret,
          adresse: dto.adresse,
          codePostal: dto.codePostal,
          ville: dto.ville,
          telephone: dto.telephone,
          estFamiliale: dto.estFamiliale,
          nomGerant: dto.nomGerant,
          prenomGerant: dto.prenomGerant
        })
        .returning();
      if (!sci) {
        throw new Error("Échec de la création de la SCI");
      }

      const rattachement = creerRattachementProprietaire({
        organisationId: user.organisationId,
        sciId: sci.id,
        dateDebut: new Date().toISOString().slice(0, 10)
      });

      await tx.insert(organisationSci).values(rattachement);

      return this.versDto(sci);
    });
  }

  // scis n'a pas de colonne organisationId directe : le scoping passe par
  // organisation_sci (table de liaison, voir create() ci-dessus). role
  // ('proprietaire' ou 'mandataire') n'est volontairement pas filtré ici —
  // les deux donnent un accès légitime à la SCI.
  async findAll() {
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const rattachements = await this.db
        .select({ sciId: organisationSci.sciId })
        .from(organisationSci)
        .where(eq(organisationSci.organisationId, organisationId));
      const sciIds = rattachements.map((rattachement) => rattachement.sciId);
      if (sciIds.length === 0) {
        return [];
      }
      const lignes = await this.db.select().from(scis).where(inArray(scis.id, sciIds));
      return lignes.map((sci) => this.versDto(sci));
    }
    const lignes = await this.db.select().from(scis);
    return lignes.map((sci) => this.versDto(sci));
  }

  // Contrôle d'appartenance (Sous-commit 5b, chantier scoping
  // multi-organisation, 2026-09-18) : scis n'a pas de colonne
  // organisationId directe (voir findAll() ci-dessus), le contrôle passe
  // par une requête organisation_sci dédiée — même chemin que
  // ComptesBancairesSciService.verifierAppartenanceSci (commit B6). Même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP). Réutilise désormais
  // resoudreSciAvecAppartenance() (Priorité 3a, 2026-09-19), partagée avec
  // update()/archive() ci-dessous.
  async findById(id: string) {
    const sci = await this.resoudreSciAvecAppartenance(id);
    return this.versDto(sci);
  }

  async update(id: string, dto: UpdateSciDto) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    exigerNonArchiveePourModifier(await this.resoudreSciAvecAppartenance(id));

    const sci = await modifierFiche(
      this.db,
      scis,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId(),
      "SCI introuvable"
    );
    return this.versDto(sci as SciRow);
  }

  async archive(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    exigerNonArchiveePourArchiver(await this.resoudreSciAvecAppartenance(id));

    // Jamais une SCI qui a encore un bail actif ou en préavis (par ses
    // biens) ou des biens non archivés (petites suites, décision 5 du
    // 2026-11-22). Même verrou que BienService.archive : la ligne de la SCI
    // en FOR UPDATE attend le verrou de clé posé par la création d'un bien
    // rattaché (clé étrangère bien.sci_id) jusqu'à sa validation. Aucun
    // autre verrou pris : pas d'interblocage.
    const utilisateurId = this.requestContext.getUtilisateurId();
    const sci = await this.db.transaction(async (tx) => {
      const [actuelle] = await tx.select().from(scis).where(eq(scis.id, id)).limit(1).for("update");
      if (!actuelle) {
        throw new NotFoundException("SCI introuvable");
      }
      exigerNonArchiveePourArchiver(actuelle);

      const [bauxEnCours] = await tx
        .select({ n: count() })
        .from(baux)
        .innerJoin(appartements, eq(appartements.id, baux.appartementId))
        .innerJoin(bien, eq(bien.id, appartements.bienId))
        .where(and(eq(bien.sciId, id), inArray(baux.statut, ["actif", "preavis"])));
      if (bauxEnCours && bauxEnCours.n > 0) {
        throw new ConflictException(messageBauxActifsSci(bauxEnCours.n));
      }
      const [biensActifs] = await tx
        .select({ n: count() })
        .from(bien)
        .where(and(eq(bien.sciId, id), isNull(bien.archivedAt)));
      if (biensActifs && biensActifs.n > 0) {
        throw new ConflictException(messageBiensNonArchives(biensActifs.n));
      }

      return archiverFiche(tx, scis, id, { statut: "archive" }, utilisateurId, "SCI introuvable");
    });
    return this.versDto(sci as SciRow);
  }

  // Contrôle d'appartenance partagé (Sous-commit 5b pour findById(), étendu
  // en Priorité 3a/Catégorie C à update()/archive() — 2026-09-19) : même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  private async resoudreSciAvecAppartenance(id: string): Promise<SciRow> {
    const [sci] = await this.db.select().from(scis).where(eq(scis.id, id)).limit(1);
    if (!sci) {
      throw new NotFoundException("SCI introuvable");
    }
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const [rattachement] = await this.db
        .select({ sciId: organisationSci.sciId })
        .from(organisationSci)
        .where(and(eq(organisationSci.sciId, id), eq(organisationSci.organisationId, organisationId)))
        .limit(1);
      if (!rattachement) {
        throw new NotFoundException("SCI introuvable");
      }
    }
    return sci;
  }

  private versDto(sci: SciRow) {
    return {
      id: sci.id,
      createdAt: sci.createdAt,
      updatedAt: sci.updatedAt,
      updatedBy: sci.updatedBy,
      version: sci.version,
      archivedAt: sci.archivedAt,
      nom: sci.nom,
      regimeFiscal: sci.regimeFiscal,
      formeJuridique: sci.formeJuridique,
      siret: sci.siret,
      adresse: sci.adresse,
      codePostal: sci.codePostal,
      ville: sci.ville,
      nomGerant: sci.nomGerant,
      prenomGerant: sci.prenomGerant,
      telephone: sci.telephone,
      estFamiliale: sci.estFamiliale,
      statut: sci.statut
    };
  }
}
