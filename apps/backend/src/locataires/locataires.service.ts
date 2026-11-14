import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { bailLocataires, baux, locataires, mettreAJourAvecAudit, type Database } from "db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateLocataireDto } from "./dto/create-locataire.dto";
import type { UpdateLocataireDto } from "./dto/update-locataire.dto";

type LocataireRow = typeof locataires.$inferSelect;

@Injectable()
export class LocatairesService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService
  ) {}

  async create(userId: string, dto: CreateLocataireDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    const [locataire] = await this.db
      .insert(locataires)
      .values({
        nom: dto.nom,
        prenom: dto.prenom,
        email: dto.email,
        telephone: dto.telephone,
        adresse: dto.adresse,
        codePostal: dto.codePostal,
        ville: dto.ville,
        dateNaissance: dto.dateNaissance,
        lieuNaissance: dto.lieuNaissance,
        statutEtudes: dto.statutEtudes,
        organisationId: user.organisationId
      })
      .returning();
    if (!locataire) {
      throw new Error("Échec de la création du locataire");
    }
    return this.versDto(locataire);
  }

  // Module Carnet de contacts (2026-09-13) : scoping multi-tenant ajouté
  // ici — même mécanisme que TachesService.findAll()/DepensesService
  // .findAll() (organisationId résolu depuis l'utilisateur authentifié,
  // no-op hors contexte HTTP réel). locataires.organisation_id est résolu
  // à la création (voir create() ci-dessus), jamais déduit par jointure à
  // la lecture — un locataire créé avant d'être rattaché à un bail reste
  // ainsi visible (voir packages/db/src/schema/locataires.ts).
  async findAll() {
    // Mécanisme centralisé (Commit 2, docs/data-dictionary.md) : lu
    // directement depuis le JWT décodé, jamais un lookup UsersService.
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const lignes = await this.db
        .select()
        .from(locataires)
        .where(eq(locataires.organisationId, organisationId));
      return lignes.map((locataire) => this.versDto(locataire));
    }
    const lignes = await this.db.select().from(locataires);
    return lignes.map((locataire) => this.versDto(locataire));
  }

  // Contrôle d'appartenance (Sous-commit 5a, chantier scoping
  // multi-organisation, 2026-09-18) : même message que "n'existe pas",
  // aucune différence observable — même principe que B1-B6. Skip si
  // organisationId absent (hors contexte HTTP). Réutilise désormais
  // resoudreLocataireAvecAppartenance() (Priorité 3a, 2026-09-19), partagée
  // avec update()/archive() ci-dessous.
  async findById(id: string) {
    const locataire = await this.resoudreLocataireAvecAppartenance(id);
    return this.versDto(locataire);
  }

  async update(id: string, dto: UpdateLocataireDto) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreLocataireAvecAppartenance(id);

    const [locataire] = await mettreAJourAvecAudit(
      this.db,
      locataires,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!locataire) {
      throw new NotFoundException("Locataire introuvable");
    }
    return this.versDto(locataire as LocataireRow);
  }

  async archive(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreLocataireAvecAppartenance(id);

    // Jamais un locataire encore en place (chantier archivage, décision 4
    // du 2026-11-12) : refus s'il reste rattaché (lien bail_locataires non
    // retiré) à un bail actif ou en préavis. Après l'appartenance (404
    // d'abord). Un lien retiré, ou un bail brouillon/résilié, n'empêche rien.
    const [lienEnCours] = await this.db
      .select({ id: bailLocataires.id })
      .from(bailLocataires)
      .innerJoin(baux, eq(baux.id, bailLocataires.bailId))
      .where(
        and(
          eq(bailLocataires.locataireId, id),
          isNull(bailLocataires.archivedAt),
          inArray(baux.statut, ["actif", "preavis"])
        )
      )
      .limit(1);
    if (lienEnCours) {
      throw new ConflictException(
        "Ce locataire est encore rattaché à un bail actif ou en préavis. Retirez-le de ce bail, ou résiliez le bail, avant de l'archiver."
      );
    }

    const [locataire] = await mettreAJourAvecAudit(
      this.db,
      locataires,
      id,
      { statut: "archive", archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!locataire) {
      throw new NotFoundException("Locataire introuvable");
    }
    return this.versDto(locataire as LocataireRow);
  }

  // Contrôle d'appartenance partagé (Sous-commit 5a pour findById(), étendu
  // en Priorité 3a/Catégorie C à update()/archive() — 2026-09-19) : même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  private async resoudreLocataireAvecAppartenance(id: string): Promise<LocataireRow> {
    const [locataire] = await this.db.select().from(locataires).where(eq(locataires.id, id)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!locataire || (organisationId && locataire.organisationId !== organisationId)) {
      throw new NotFoundException("Locataire introuvable");
    }
    return locataire;
  }

  // anonymise_le (champ interne au mécanisme d'anonymisation RGPD, pas
  // encore implémenté — packages/db/src/schema/locataires.ts) n'est
  // exposé ni ici ni par le Sync Stream locataires. Aucun code frontend
  // n'en dépend en lecture.
  private versDto(locataire: LocataireRow) {
    return {
      id: locataire.id,
      createdAt: locataire.createdAt,
      updatedAt: locataire.updatedAt,
      updatedBy: locataire.updatedBy,
      version: locataire.version,
      archivedAt: locataire.archivedAt,
      nom: locataire.nom,
      prenom: locataire.prenom,
      email: locataire.email,
      telephone: locataire.telephone,
      adresse: locataire.adresse,
      codePostal: locataire.codePostal,
      ville: locataire.ville,
      dateNaissance: locataire.dateNaissance,
      lieuNaissance: locataire.lieuNaissance,
      statut: locataire.statut,
      statutEtudes: locataire.statutEtudes
    };
  }
}
