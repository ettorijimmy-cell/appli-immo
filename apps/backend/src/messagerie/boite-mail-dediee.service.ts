import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { boiteMailDediee, mettreAJourAvecAudit, type Database } from "db";
import { and, eq, isNull } from "drizzle-orm";
import { AuditService } from "../audit/audit.service";
import { RequestContextService } from "../common/request-context";
import { EncryptionService } from "../crypto/encryption.service";
import { DATABASE_CONNECTION } from "../database/database.module";
import { UsersService } from "../users/users.service";
import { BoiteMailNonConfigureeException } from "./boite-mail-non-configuree.exception";
import type { ConfigurerBoiteMailDedieeDto } from "./dto/configurer-boite-mail-dediee.dto";

export interface StatutBoiteMailDediee {
  configuree: boolean;
  email: string | null;
}

type BoiteMailDedieeRow = typeof boiteMailDediee.$inferSelect;

/**
 * Module Messagerie (2026-09-16). Une seule ligne active par organisation
 * (index unique partiel, voir packages/db/src/schema/boite-mail-dediee.ts)
 * — configurer() archive l'ancienne avant d'insérer la nouvelle, jamais
 * modifiée en place (historique conservé, même principe que
 * connexion_gmail/GoogleOAuthService.traiterCallback).
 */
@Injectable()
export class BoiteMailDedieeService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    private readonly usersService: UsersService
  ) {}

  async configurer(userId: string, dto: ConfigurerBoiteMailDedieeDto): Promise<StatutBoiteMailDediee> {
    const organisationId = await this.resoudreOrganisationId(userId);

    await this.db.transaction(async (tx) => {
      await tx
        .update(boiteMailDediee)
        .set({ archivedAt: new Date() })
        .where(and(eq(boiteMailDediee.organisationId, organisationId), isNull(boiteMailDediee.archivedAt)));

      await tx.insert(boiteMailDediee).values({
        organisationId,
        email: dto.email,
        motDePasseAppChiffre: this.encryptionService.encrypt(dto.motDePasseApp)
      });
    });

    return { configuree: true, email: dto.email };
  }

  async obtenirStatut(userId: string): Promise<StatutBoiteMailDediee> {
    const organisationId = await this.resoudreOrganisationId(userId);
    const boite = await this.trouverActive(organisationId);
    return boite ? { configuree: true, email: boite.email } : { configuree: false, email: null };
  }

  /**
   * Identifiants en clair pour une connexion IMAP/SMTP réelle — jamais
   * renvoyés au frontend (CLAUDE.md), utilisés uniquement côté serveur au
   * moment de la connexion. Journalise l'accès dans journal_audit
   * uniquement si un utilisateur humain est en contexte (requête HTTP) —
   * un job planifié (ImapSyncJobService) qui déchiffre pour se connecter
   * lui-même n'est pas un accès humain à tracer, même principe que
   * mettreAJourAvecAudit avec un utilisateurId null pour updatedBy.
   */
  async obtenirIdentifiants(organisationId: string): Promise<{ email: string; motDePasseApp: string }> {
    const boite = await this.trouverActive(organisationId);
    if (!boite) {
      throw new BoiteMailNonConfigureeException(
        "Aucune boîte mail dédiée configurée pour cette organisation — configurez-la depuis Paramètres."
      );
    }
    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      await this.auditService.logAccesDonneeSensible({
        entiteType: "boite_mail_dediee",
        entiteId: boite.id,
        utilisateurId
      });
    }
    return { email: boite.email, motDePasseApp: this.encryptionService.decrypt(boite.motDePasseAppChiffre) };
  }

  async trouverActive(organisationId: string): Promise<BoiteMailDedieeRow | null> {
    const [boite] = await this.db
      .select()
      .from(boiteMailDediee)
      .where(and(eq(boiteMailDediee.organisationId, organisationId), isNull(boiteMailDediee.archivedAt)))
      .limit(1);
    return boite ?? null;
  }

  // Appelé exclusivement par ImapSyncJobService après un lot importé avec
  // succès — jamais par une requête HTTP, d'où utilisateurId=null explicite
  // (aucun utilisateur n'a "modifié" la config, c'est une progression
  // technique interne).
  async mettreAJourDernierUidSynchronise(boiteId: string, uid: number): Promise<void> {
    await mettreAJourAvecAudit(this.db, boiteMailDediee, boiteId, { dernierUidSynchronise: uid }, null);
  }

  private async resoudreOrganisationId(userId: string): Promise<string> {
    const utilisateur = await this.usersService.findById(userId);
    if (!utilisateur) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    return utilisateur.organisationId;
  }
}
