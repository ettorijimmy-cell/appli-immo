import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { candidat, documents, mettreAJourAvecAudit, type Database } from "db";
import { and, eq, sql } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { LocatairesService } from "../locataires/locataires.service";
import { UsersService } from "../users/users.service";
import type { CreateCandidatDto } from "./dto/create-candidat.dto";
import type { UpdateCandidatDto } from "./dto/update-candidat.dto";

type CandidatRow = typeof candidat.$inferSelect;

@Injectable()
export class CandidatsService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService,
    private readonly locatairesService: LocatairesService
  ) {}

  async create(userId: string, dto: CreateCandidatDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    const [ligne] = await this.db
      .insert(candidat)
      .values({
        nom: dto.nom,
        prenom: dto.prenom,
        telephone: dto.telephone,
        email: dto.email,
        appartementId: dto.appartementId,
        notes: dto.notes,
        statut: dto.statut,
        revenuMensuelNet: dto.revenuMensuelNet,
        loyerVise: dto.loyerVise,
        situationProfessionnelle: dto.situationProfessionnelle,
        garantNom: dto.garantNom,
        garantRevenuMensuelNet: dto.garantRevenuMensuelNet,
        organisationId: user.organisationId
      })
      .returning();
    if (!ligne) {
      throw new Error("Échec de la création du candidat");
    }
    return this.versDto(ligne);
  }

  // Même pattern de scoping que ContactsService/LocatairesService — no-op
  // en dehors d'un contexte HTTP (scripts/tests directs). Mécanisme
  // centralisé (Commit 2, docs/data-dictionary.md) : lu directement
  // depuis le JWT décodé, jamais un lookup UsersService.
  async findAll() {
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId) {
      const lignes = await this.db.select().from(candidat).where(eq(candidat.organisationId, organisationId));
      return lignes.map((ligne) => this.versDto(ligne));
    }
    const lignes = await this.db.select().from(candidat);
    return lignes.map((ligne) => this.versDto(ligne));
  }

  // Contrôle d'appartenance (Sous-commit 5a, chantier scoping
  // multi-organisation, 2026-09-18) : même message que "n'existe pas",
  // aucune différence observable — même principe que B1-B6. Skip si
  // organisationId absent (hors contexte HTTP). Réutilise désormais
  // resoudreCandidatAvecAppartenance() (Priorité 2, Catégorie C,
  // 2026-09-19), partagée avec convertirEnLocataire() ci-dessous.
  async findById(id: string) {
    const ligne = await this.resoudreCandidatAvecAppartenance(id);
    return this.versDto(ligne);
  }

  async update(id: string, dto: UpdateCandidatDto) {
    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      candidat,
      id,
      { ...dto },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Candidat introuvable");
    }
    return this.versDto(ligne as CandidatRow);
  }

  async archive(id: string) {
    const [ligne] = await mettreAJourAvecAudit(
      this.db,
      candidat,
      id,
      { archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!ligne) {
      throw new NotFoundException("Candidat introuvable");
    }
    return this.versDto(ligne as CandidatRow);
  }

  // Extension checklist candidat (2026-09-15) : crée un locataire directement
  // depuis candidat.nom/prenom/telephone/email (aucune ressaisie — prenom a
  // été séparé de nom exactement pour permettre cette copie directe, voir
  // packages/db/src/schema/candidat.ts) et passe candidat.statut à
  // 'converti'. Ne génère JAMAIS de bail : les données de bail (dates,
  // loyer réel) n'existent pas dans le dossier candidat, ce serait les
  // deviner — la création du bail reste un geste séparé via l'écran
  // Patrimoine existant, décision actée avec Jimmy.
  //
  // Documents : ceux du candidat lui-même (candidat_role='candidat') sont
  // rattachés au nouveau locataire (entiteType/entiteId mis à jour,
  // candidat_role vidé — n'a plus de sens hors contexte candidat). Ceux du
  // garant (candidat_role='garant') restent sur le dossier candidat
  // archivé : aucune destination logique à cette étape, la conversion ne
  // crée aucune entité `garant` réelle.
  //
  // Pas de transaction DB unique ici (LocatairesService.create() a sa
  // propre connexion) : un échec d'une étape après la création du
  // locataire laisserait les trois écritures désynchronisées. Risque
  // accepté pour une action manuelle et peu fréquente plutôt que de
  // dupliquer l'insertion de locataire dans ce service pour partager une
  // transaction — à revoir si ce cas se présente réellement en pratique.
  async convertirEnLocataire(userId: string, candidatId: string) {
    // Contrôle d'appartenance AVANT toute lecture/écriture exploitant le
    // candidat (Priorité 2, Catégorie C, chantier scoping multi-organisation,
    // 2026-09-19) : sans lui, un candidatId d'une autre organisation menait
    // à créer un vrai locataire à partir de ses données, et à réattribuer
    // ses documents (entiteType/entiteId réécrits) — divulgation ET
    // intégrité combinées.
    const candidatActuel = await this.resoudreCandidatAvecAppartenance(candidatId);
    if (candidatActuel.statut === "converti") {
      throw new ConflictException("Ce candidat a déjà été converti en locataire.");
    }
    if (!candidatActuel.prenom) {
      throw new BadRequestException(
        "Le prénom du candidat doit être renseigné avant la conversion en locataire — complétez sa fiche d'abord."
      );
    }

    const locataireCree = await this.locatairesService.create(userId, {
      nom: candidatActuel.nom,
      prenom: candidatActuel.prenom,
      ...(candidatActuel.telephone && { telephone: candidatActuel.telephone }),
      ...(candidatActuel.email && { email: candidatActuel.email })
    });

    await this.db
      .update(documents)
      .set({
        entiteType: "locataire",
        entiteId: locataireCree.id,
        candidatRole: null,
        updatedAt: new Date(),
        updatedBy: this.requestContext.getUtilisateurId(),
        version: sql`${documents.version} + 1`
      })
      .where(
        and(eq(documents.entiteType, "candidat"), eq(documents.entiteId, candidatId), eq(documents.candidatRole, "candidat"))
      );

    const [candidatMisAJour] = await mettreAJourAvecAudit(
      this.db,
      candidat,
      candidatId,
      { statut: "converti" },
      this.requestContext.getUtilisateurId()
    );
    if (!candidatMisAJour) {
      throw new Error(
        `Le locataire ${locataireCree.id} a été créé, mais la mise à jour du statut du candidat ${candidatId} a échoué — vérifier manuellement.`
      );
    }

    return { locataire: locataireCree, candidat: this.versDto(candidatMisAJour as CandidatRow) };
  }

  // Contrôle d'appartenance partagé (Sous-commit 5a pour findById(), étendu
  // en Priorité 2/Catégorie C à convertirEnLocataire() — 2026-09-19) : même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP). Renvoie la ligne brute (pas
  // le DTO) : convertirEnLocataire() a besoin des colonnes internes
  // (nom/prenom/telephone/email/statut), pas de la projection publique.
  private async resoudreCandidatAvecAppartenance(id: string): Promise<CandidatRow> {
    const [ligne] = await this.db.select().from(candidat).where(eq(candidat.id, id)).limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!ligne || (organisationId && ligne.organisationId !== organisationId)) {
      throw new NotFoundException("Candidat introuvable");
    }
    return ligne;
  }

  private versDto(ligne: CandidatRow) {
    return {
      id: ligne.id,
      createdAt: ligne.createdAt,
      updatedAt: ligne.updatedAt,
      updatedBy: ligne.updatedBy,
      version: ligne.version,
      archivedAt: ligne.archivedAt,
      nom: ligne.nom,
      prenom: ligne.prenom,
      telephone: ligne.telephone,
      email: ligne.email,
      appartementId: ligne.appartementId,
      notes: ligne.notes,
      statut: ligne.statut,
      revenuMensuelNet: ligne.revenuMensuelNet,
      loyerVise: ligne.loyerVise,
      situationProfessionnelle: ligne.situationProfessionnelle,
      garantNom: ligne.garantNom,
      garantRevenuMensuelNet: ligne.garantRevenuMensuelNet,
      organisationId: ligne.organisationId
    };
  }
}
