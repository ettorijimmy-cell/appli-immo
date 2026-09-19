import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { bien, bienImmeubleDetail, mettreAJourAvecAudit, organisationSci, scis, type Database } from "db";
import { and, eq } from "drizzle-orm";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import type { CreateBienDto } from "./dto/create-bien.dto";
import type { UpdateBienDto } from "./dto/update-bien.dto";

type BienRow = typeof bien.$inferSelect;
type BienImmeubleDetailRow = typeof bienImmeubleDetail.$inferSelect;

@Injectable()
export class BienService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly usersService: UsersService,
    private readonly requestContext: RequestContextService
  ) {}

  async create(userId: string, dto: CreateBienDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }

    // Même contraintes que bien_sci_id_coherent / bien_nom_requis_si_immeuble
    // en base (packages/db/src/schema/bien.ts) — vérifiées ici pour un
    // message d'erreur clair avant d'atteindre la contrainte SQL.
    if (dto.proprietaireType === "sci" && !dto.sciId) {
      throw new BadRequestException("sciId est requis lorsque proprietaireType vaut 'sci'.");
    }
    if (dto.proprietaireType === "sci" && dto.nomProprietaire) {
      throw new BadRequestException("nomProprietaire doit être absent lorsque proprietaireType vaut 'sci'.");
    }
    if (dto.proprietaireType === "personne_physique" && dto.sciId) {
      throw new BadRequestException("sciId doit être absent lorsque proprietaireType vaut 'personne_physique'.");
    }
    if (dto.proprietaireType === "personne_physique" && !dto.nomProprietaire) {
      throw new BadRequestException("nomProprietaire est requis lorsque proprietaireType vaut 'personne_physique'.");
    }
    if (dto.type === "immeuble" && !dto.nom) {
      throw new BadRequestException("nom est requis pour un bien de type 'immeuble'.");
    }

    // Contrôle d'appartenance sur dto.sciId (Priorité E2, chantier scoping
    // multi-organisation, Catégorie E, 2026-09-19) : jusqu'ici inséré sans
    // aucun contrôle, même pas d'existence. bien.organisationId reste bien
    // résolu depuis l'utilisateur (voir insert ci-dessous), mais un sciId
    // d'une autre organisation restait acceptable — sa conséquence
    // concrète était que resoudreNomBailleur() (voir plus bas, durci dans
    // ce même commit) injectait le nom de la SCI étrangère comme
    // "bailleur" dans les documents de bail/quittance générés. Ne peut pas
    // réutiliser ComptesBancairesSciService.verifierAppartenanceSci (privée,
    // et BienModule ne dépend pas de ComptesBancairesSciModule) : même
    // vérification reproduite ici (voir verifierAppartenanceSci ci-dessous).
    if (dto.sciId) {
      await this.verifierAppartenanceSci(dto.sciId);
    }

    // typeHabitat/regimeJuridique (déplacés sur bien le 2026-08-26, voir
    // packages/db/src/schema/bien.ts) : dérivés automatiquement pour
    // 'maison' — vrai par définition d'une maison individuelle, aucune
    // saisie possible ni blocage de complétude envisageable pour ce type.
    // Requis explicitement pour tout autre type : ambigu par nature (un
    // appartement_isole ou un parking peuvent être dans un ensemble
    // collectif en copropriété) — même exigence qu'aujourd'hui sur un
    // immeuble, inchangée.
    let typeHabitat = dto.typeHabitat;
    let regimeJuridique = dto.regimeJuridique;
    if (dto.type === "maison") {
      typeHabitat = "individuel";
      regimeJuridique = "mono_propriete";
    } else if (!typeHabitat || !regimeJuridique) {
      throw new BadRequestException(`typeHabitat et regimeJuridique sont requis pour un bien de type '${dto.type}'.`);
    }

    return this.db.transaction(async (tx) => {
      const [nouveauBien] = await tx
        .insert(bien)
        .values({
          type: dto.type,
          proprietaireType: dto.proprietaireType,
          // organisationId résolu côté serveur depuis l'utilisateur
          // authentifié — jamais transmis par le client (même mécanisme
          // que ScisService.create -> creerRattachementProprietaire).
          organisationId: user.organisationId,
          sciId: dto.proprietaireType === "sci" ? (dto.sciId ?? null) : null,
          nomProprietaire: dto.proprietaireType === "personne_physique" ? (dto.nomProprietaire ?? null) : null,
          adresse: dto.adresse,
          codePostal: dto.codePostal,
          ville: dto.ville,
          nom: dto.nom ?? null,
          anneeConstruction: dto.anneeConstruction,
          dateAcquisition: dto.dateAcquisition,
          valeurAcquisition: dto.valeurAcquisition,
          typeHabitat,
          regimeJuridique
        })
        .returning();
      if (!nouveauBien) {
        throw new Error("Échec de la création du bien");
      }

      // bien_immeuble_detail ne porte plus que syndic/nbLots/
      // chargesCoproAnnuelles (typeHabitat/regimeJuridique vivent
      // désormais sur bien ci-dessus) — toujours réservé au seul
      // type='immeuble', sans changement sur ce point.
      let detail: BienImmeubleDetailRow | null = null;
      if (dto.type === "immeuble") {
        const [detailRow] = await tx
          .insert(bienImmeubleDetail)
          .values({
            bienId: nouveauBien.id,
            syndic: dto.syndic,
            nbLots: dto.nbLots,
            chargesCoproAnnuelles: dto.chargesCoproAnnuelles
          })
          .returning();
        detail = detailRow ?? null;
      }

      return this.versDto(nouveauBien, detail);
    });
  }

  // organisationId est une colonne directe de bien (voir create() ci-dessus)
  // : aucune jointure requise, contrairement à ScisService/AppartementsService.
  async findAll(sciId?: string) {
    const organisationId = this.requestContext.getOrganisationId();
    const conditions = [
      ...(sciId ? [eq(bien.sciId, sciId)] : []),
      ...(organisationId ? [eq(bien.organisationId, organisationId)] : [])
    ];
    const rows =
      conditions.length > 0
        ? await this.db
            .select({ bien, detail: bienImmeubleDetail })
            .from(bien)
            .leftJoin(bienImmeubleDetail, eq(bienImmeubleDetail.bienId, bien.id))
            .where(and(...conditions))
        : await this.db
            .select({ bien, detail: bienImmeubleDetail })
            .from(bien)
            .leftJoin(bienImmeubleDetail, eq(bienImmeubleDetail.bienId, bien.id));
    return rows.map((row) => this.versDto(row.bien, row.detail));
  }

  // Contrôle d'appartenance (Sous-commit 5a, chantier scoping
  // multi-organisation, 2026-09-18) : même message que "n'existe pas",
  // aucune différence observable — même principe que B1-B6. Skip si
  // organisationId absent (hors contexte HTTP). Réutilise désormais
  // resoudreBienAvecAppartenance() (Priorité 3a, 2026-09-19), partagée avec
  // update()/archive() ci-dessous.
  async findById(id: string) {
    const { bienRow, detailRow } = await this.resoudreBienAvecAppartenance(id);
    return this.versDto(bienRow, detailRow);
  }

  /**
   * Résout le nom du bailleur à afficher sur un document généré (bail,
   * quittance — Module Tâches, Étape 4, docs/backlog.md) : sci.nom pour un
   * bien en SCI, bien.nomProprietaire pour un bien en nom propre. Service
   * partagé entre bail-document-docx et le générateur de quittance — aucun
   * des deux ne doit résoudre cette logique lui-même (corrige le bug
   * découvert dans bail-document-docx.service.ts, qui échouait
   * (NotFoundException) pour tout bien proprietaireType='personne_physique'
   * faute d'alternative à sci.nom).
   *
   * Défense en profondeur (Priorité E2, chantier scoping multi-organisation,
   * Catégorie E, 2026-09-19) : la requête sur `scis` est filtrée via
   * organisation_sci sur l'organisation propriétaire du bien (bien.organisationId,
   * jamais celle de l'appelant HTTP — cette méthode peut être invoquée hors
   * contexte HTTP) plutôt qu'un JOIN direct sur scis.id. Ne dépend donc pas
   * uniquement du contrôle désormais posé à l'écriture (create()/update()
   * ci-dessous) : protège aussi d'éventuelles données historiques
   * incohérentes. Si le sciId d'un bien ne correspond pas à son
   * organisation, la méthode renvoie null plutôt que le nom d'une SCI
   * étrangère — les deux appelants (bail-document-docx,
   * quittance-document-docx) traitent déjà un résultat null comme un
   * "bailleur introuvable" bloquant la génération, pas comme une valeur
   * vide affichée telle quelle.
   */
  async resoudreNomBailleur(bienId: string): Promise<string | null> {
    const [bienRow] = await this.db
      .select({
        proprietaireType: bien.proprietaireType,
        sciId: bien.sciId,
        nomProprietaire: bien.nomProprietaire,
        organisationId: bien.organisationId
      })
      .from(bien)
      .where(eq(bien.id, bienId))
      .limit(1);
    if (!bienRow) {
      return null;
    }
    if (bienRow.proprietaireType === "personne_physique") {
      return bienRow.nomProprietaire;
    }
    if (!bienRow.sciId) {
      return null;
    }
    const [sci] = await this.db
      .select({ nom: scis.nom })
      .from(scis)
      .innerJoin(organisationSci, eq(organisationSci.sciId, scis.id))
      .where(and(eq(scis.id, bienRow.sciId), eq(organisationSci.organisationId, bienRow.organisationId)))
      .limit(1);
    return sci?.nom ?? null;
  }

  // Reproduit ComptesBancairesSciService.verifierAppartenanceSci (privée,
  // non réutilisable ici — BienModule ne dépend pas de
  // ComptesBancairesSciModule). Skip si organisationId absent (hors
  // contexte HTTP, comportement préexistant préservé). Même message que
  // "n'existe pas", aucune différence observable.
  private async verifierAppartenanceSci(sciId: string): Promise<void> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      return;
    }
    const [rattachement] = await this.db
      .select({ sciId: organisationSci.sciId })
      .from(organisationSci)
      .where(and(eq(organisationSci.sciId, sciId), eq(organisationSci.organisationId, organisationId)))
      .limit(1);
    if (!rattachement) {
      throw new NotFoundException("SCI introuvable");
    }
  }

  async update(id: string, dto: UpdateBienDto) {
    // Contrôle d'appartenance AVANT toute lecture/écriture (Priorité 3a,
    // Catégorie C, chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreBienAvecAppartenance(id);

    const { typeHabitat, regimeJuridique, syndic, nbLots, chargesCoproAnnuelles, ...bienChamps } = dto;

    // typeHabitat/regimeJuridique restent immuables pour un bien de type
    // 'maison' (dérivés à la création, jamais une préférence utilisateur —
    // voir create() ci-dessus) : rejeté explicitement plutôt que d'accepter
    // silencieusement une valeur qui contredirait la réalité légale.
    if (typeHabitat !== undefined || regimeJuridique !== undefined) {
      const [bienExistant] = await this.db.select({ type: bien.type }).from(bien).where(eq(bien.id, id)).limit(1);
      if (!bienExistant) {
        throw new NotFoundException("Bien introuvable");
      }
      if (bienExistant.type === "maison") {
        throw new BadRequestException(
          "typeHabitat et regimeJuridique sont dérivés automatiquement pour un bien de type 'maison' et ne peuvent pas être modifiés."
        );
      }
    }

    const [bienMisAJour] = await mettreAJourAvecAudit(
      this.db,
      bien,
      id,
      { ...bienChamps, typeHabitat, regimeJuridique },
      this.requestContext.getUtilisateurId()
    );
    if (!bienMisAJour) {
      throw new NotFoundException("Bien introuvable");
    }

    const [detailExistant] = await this.db
      .select()
      .from(bienImmeubleDetail)
      .where(eq(bienImmeubleDetail.bienId, id))
      .limit(1);

    const champsDetail = { syndic, nbLots, chargesCoproAnnuelles };
    const detailFourni = Object.values(champsDetail).some((valeur) => valeur !== undefined);

    let detail: BienImmeubleDetailRow | null = detailExistant ?? null;
    if (detailFourni) {
      if (!detailExistant) {
        throw new BadRequestException(
          "Impossible de mettre à jour des champs propres à bien_immeuble_detail : ce bien n'est pas de type 'immeuble'."
        );
      }
      const [detailMisAJour] = await mettreAJourAvecAudit(
        this.db,
        bienImmeubleDetail,
        detailExistant.id,
        { ...champsDetail },
        this.requestContext.getUtilisateurId()
      );
      detail = (detailMisAJour as BienImmeubleDetailRow | undefined) ?? null;
    }

    return this.versDto(bienMisAJour as BienRow, detail);
  }

  async archive(id: string) {
    // Contrôle d'appartenance AVANT toute écriture (Priorité 3a, Catégorie C,
    // chantier scoping multi-organisation, 2026-09-19).
    await this.resoudreBienAvecAppartenance(id);

    const [bienArchive] = await mettreAJourAvecAudit(
      this.db,
      bien,
      id,
      { statut: "archive", archivedAt: new Date() },
      this.requestContext.getUtilisateurId()
    );
    if (!bienArchive) {
      throw new NotFoundException("Bien introuvable");
    }
    const [detail] = await this.db
      .select()
      .from(bienImmeubleDetail)
      .where(eq(bienImmeubleDetail.bienId, id))
      .limit(1);
    return this.versDto(bienArchive as BienRow, detail ?? null);
  }

  // Contrôle d'appartenance partagé (Sous-commit 5a pour findById(), étendu
  // en Priorité 3a/Catégorie C à update()/archive() — 2026-09-19) : même
  // message que "n'existe pas", aucune différence observable. Skip si
  // organisationId absent (hors contexte HTTP).
  private async resoudreBienAvecAppartenance(id: string): Promise<{ bienRow: BienRow; detailRow: BienImmeubleDetailRow | null }> {
    const [row] = await this.db
      .select({ bien, detail: bienImmeubleDetail })
      .from(bien)
      .leftJoin(bienImmeubleDetail, eq(bienImmeubleDetail.bienId, bien.id))
      .where(eq(bien.id, id))
      .limit(1);
    const organisationId = this.requestContext.getOrganisationId();
    if (!row || (organisationId && row.bien.organisationId !== organisationId)) {
      throw new NotFoundException("Bien introuvable");
    }
    return { bienRow: row.bien, detailRow: row.detail };
  }

  private versDto(bienRow: BienRow, detail: BienImmeubleDetailRow | null) {
    return {
      id: bienRow.id,
      createdAt: bienRow.createdAt,
      updatedAt: bienRow.updatedAt,
      updatedBy: bienRow.updatedBy,
      version: bienRow.version,
      archivedAt: bienRow.archivedAt,
      type: bienRow.type,
      proprietaireType: bienRow.proprietaireType,
      sciId: bienRow.sciId,
      nomProprietaire: bienRow.nomProprietaire,
      organisationId: bienRow.organisationId,
      adresse: bienRow.adresse,
      codePostal: bienRow.codePostal,
      ville: bienRow.ville,
      nom: bienRow.nom,
      anneeConstruction: bienRow.anneeConstruction,
      dateAcquisition: bienRow.dateAcquisition,
      valeurAcquisition: bienRow.valeurAcquisition,
      typeHabitat: bienRow.typeHabitat,
      regimeJuridique: bienRow.regimeJuridique,
      statut: bienRow.statut,
      syndic: detail?.syndic ?? null,
      nbLots: detail?.nbLots ?? null,
      chargesCoproAnnuelles: detail?.chargesCoproAnnuelles ?? null
    };
  }
}
