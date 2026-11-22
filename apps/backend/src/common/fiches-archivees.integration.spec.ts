import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  appartements,
  bailLocataires,
  baux,
  bien,
  candidat,
  contact,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  documents,
  equipements,
  evenementCalendrier,
  garants,
  journalAudit,
  locataires,
  messageCommunication,
  organisations,
  paiements,
  regleCategorisation,
  remboursements,
  scis,
  sinistre,
  utilisateurs,
  versements,
  type Database
} from "db";
import { count, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BailLocatairesModule } from "../bail-locataires/bail-locataires.module";
import { BailLocatairesService } from "../bail-locataires/bail-locataires.service";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CandidatsModule } from "../candidats/candidats.module";
import { CandidatsService } from "../candidats/candidats.service";
import { ContactsModule } from "../contacts/contacts.module";
import { ContactsService } from "../contacts/contacts.service";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { DocumentsService } from "../documents/documents.service";
import { EquipementsModule } from "../equipements/equipements.module";
import { EquipementsService } from "../equipements/equipements.service";
import { EvenementsCalendrierModule } from "../evenements-calendrier/evenements-calendrier.module";
import { EvenementsCalendrierService } from "../evenements-calendrier/evenements-calendrier.service";
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { MessagerieModule } from "../messagerie/messagerie.module";
import { MessagesCommunicationService } from "../messagerie/messages-communication.service";
import { PaiementsModule } from "../paiements/paiements.module";
import { PaiementsService } from "../paiements/paiements.service";
import { ReglesCategorisationModule } from "../regles-categorisation/regles-categorisation.module";
import { ReglesCategorisationService } from "../regles-categorisation/regles-categorisation.service";
import { RemboursementsModule } from "../remboursements/remboursements.module";
import { RemboursementsService } from "../remboursements/remboursements.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { SinistresModule } from "../sinistres/sinistres.module";
import { SinistresService } from "../sinistres/sinistres.service";
import { DocumentStorageService } from "../storage/document-storage.service";
import { StorageModule } from "../storage/storage.module";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { CommonModule } from "./common.module";
import { RequestContextService } from "./request-context";

// Petites suites, décision 4 (2026-11-22) et audit des petites suites,
// point 6 a/b. Pour chaque entité archivable par une route :
// - archiver une fiche déjà archivée → 409 « Déjà archivé le JJ/MM/AAAA. »
//   (date de l'archivage existant), sans aucune écriture (archived_at,
//   updated_at, updated_by, version et journal_audit inchangés) ;
// - modifier une fiche archivée → 409 « Cette fiche est archivée : elle ne
//   peut plus être modifiée. », sans aucune écriture ;
// - la fiche archivée d'une autre organisation reste un 404 (contrôle
//   d'appartenance d'abord) ;
// - deux archivages lancés en même temps : un seul réussit.

const MESSAGE_FICHE_ARCHIVEE = "Cette fiche est archivée : elle ne peut plus être modifiée.";

function dateFrancaise(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

interface TableArchivable extends PgTable {
  id: PgColumn;
  version: PgColumn;
  updatedAt: PgColumn;
  updatedBy: PgColumn;
  archivedAt: PgColumn;
}

interface Instantane {
  archivedAt: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
  version: number;
  journal: number;
}

interface Cas {
  nom: string;
  table: TableArchivable;
  creer: () => Promise<string>;
  archiver: (id: string) => Promise<unknown>;
  modifier?: (id: string) => Promise<unknown>;
  // Ligne parente que l'action peut réécrire (le paiement d'un versement,
  // dont l'annulation recalcule le statut) : photographiée elle aussi.
  parentDe?: (id: string) => Promise<{ table: TableArchivable; id: string }>;
  // Libellé du 409 « Déjà … le » : « annulé » pour un versement (son
  // archivage est une annulation, compléments du 2026-11-22 soir).
  dejaFait?: "annulé";
}

function messageDeja(c: Cas, archivedAt: Date): string {
  return `Déjà ${c.dejaFait ?? "archivé"} le ${dateFrancaise(archivedAt)}.`;
}

describe("Fiches archivées : archiver deux fois, modifier une fiche archivée (intégration Postgres réelle)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-fiches-archivees-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let requestContextService: RequestContextService;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let bauxService: BauxService;
  let locatairesService: LocatairesService;
  let bailLocatairesService: BailLocatairesService;
  let candidatsService: CandidatsService;
  let contactsService: ContactsService;
  let equipementsService: EquipementsService;
  let evenementsService: EvenementsCalendrierService;
  let garantsService: GarantsService;
  let sinistresService: SinistresService;
  let reglesService: ReglesCategorisationService;
  let messagesService: MessagesCommunicationService;
  let documentsService: DocumentsService;
  let paiementsService: PaiementsService;
  let versementsService: VersementsService;
  let remboursementsService: RemboursementsService;

  let orgA: { organisationId: string; userId: string; bienId: string; sciId: string };
  let orgB: { organisationId: string; userId: string };

  function enA<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte(
      { utilisateurId: orgA.userId, organisationId: orgA.organisationId },
      fn
    );
  }
  function enB<T>(fn: () => Promise<T>): Promise<T> {
    return requestContextService.executerAvecContexte(
      { utilisateurId: orgB.userId, organisationId: orgB.organisationId },
      fn
    );
  }

  async function creerOrganisation(suffixe: string) {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Fiches archivées ${suffixe}` })
      .returning();
    if (!organisation) {
      throw new Error("Échec de l'insertion de l'organisation de test");
    }
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation.id,
        email: `fiches-archivees-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `FichesArchivees${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    if (!user) {
      throw new Error("Échec de l'insertion de l'utilisateur de test");
    }
    return { organisationId: organisation.id, userId: user.id };
  }

  async function creerAppartement(numero: string): Promise<string> {
    const appartement = await appartementsService.create({
      bienId: orgA.bienId,
      numero,
      type: "T2",
      nombrePiecesPrincipales: 2,
      modeChauffage: "individuel",
      modeEauChaude: "individuel"
    });
    return appartement.id;
  }

  async function creerBailBrouillon(): Promise<string> {
    const appartementId = await creerAppartement(`B-${randomUUID().slice(0, 6)}`);
    const bail = await bauxService.create({
      appartementId,
      typeBail: "vide",
      dateDebut: "2026-01-01",
      loyerMensuel: "700.00"
    });
    return bail.id;
  }

  async function instantane(table: TableArchivable, id: string): Promise<Instantane> {
    const [ligne] = await db
      .select({
        archivedAt: table.archivedAt,
        updatedAt: table.updatedAt,
        updatedBy: table.updatedBy,
        version: table.version
      })
      .from(table)
      .where(eq(table.id, id));
    if (!ligne) {
      throw new Error("Ligne introuvable pour l'instantané");
    }
    const [journal] = await db.select({ n: count() }).from(journalAudit);
    return {
      archivedAt: ligne.archivedAt as Date | null,
      updatedAt: ligne.updatedAt as Date,
      updatedBy: ligne.updatedBy as string | null,
      version: ligne.version as number,
      journal: journal?.n ?? 0
    };
  }

  const cas: Cas[] = [
    {
      nom: "SCI",
      table: scis,
      creer: async () => (await scisService.create(orgA.userId, { nom: "SCI à archiver", regimeFiscal: "IR", adresse: "2 rue de Test", codePostal: "75002", ville: "Paris" })).id,
      archiver: (id) => scisService.archive(id),
      modifier: (id) => scisService.update(id, { nom: "SCI renommée" })
    },
    {
      nom: "bien",
      table: bien,
      creer: async () =>
        (
          await bienService.create(orgA.userId, {
            type: "maison",
            proprietaireType: "personne_physique",
            nomProprietaire: "Propriétaire",
            adresse: "3 rue de Test",
            codePostal: "75003",
            ville: "Paris"
          })
        ).id,
      archiver: (id) => bienService.archive(id),
      modifier: (id) => bienService.update(id, { ville: "Lyon" })
    },
    {
      nom: "appartement",
      table: appartements,
      creer: () => creerAppartement(`A-${randomUUID().slice(0, 6)}`),
      archiver: (id) => appartementsService.archive(id),
      modifier: (id) => appartementsService.update(id, { numero: "Z" })
    },
    {
      nom: "bail (brouillon)",
      table: baux,
      creer: () => creerBailBrouillon(),
      archiver: (id) => bauxService.archive(id),
      modifier: (id) => bauxService.update(id, { jourEcheance: 10 })
    },
    {
      nom: "locataire",
      table: locataires,
      creer: async () => (await locatairesService.create(orgA.userId, { nom: "Martin", prenom: "Léa" })).id,
      archiver: (id) => locatairesService.archive(id),
      modifier: (id) => locatairesService.update(id, { prenom: "Léonie" })
    },
    {
      // Rattachement locataire–bail : la date d'effet du congé reste
      // volontairement modifiable sur un lien retiré (exception signalée,
      // non tranchée) — pas de cas « modifier » ici.
      nom: "rattachement locataire–bail",
      table: bailLocataires,
      creer: async () => {
        const bailId = await creerBailBrouillon();
        const locataire = await locatairesService.create(orgA.userId, { nom: "Bernard", prenom: "Hugo" });
        return (await bailLocatairesService.create({ bailId, locataireId: locataire.id, role: "titulaire" })).id;
      },
      archiver: (id) => bailLocatairesService.archive(id)
    },
    {
      nom: "candidat",
      table: candidat,
      creer: async () => (await candidatsService.create(orgA.userId, { nom: "Petit", prenom: "Jules" })).id,
      archiver: (id) => candidatsService.archive(id),
      modifier: (id) => candidatsService.update(id, { prenom: "Julien" })
    },
    {
      nom: "contact",
      table: contact,
      creer: async () =>
        (await contactsService.create(orgA.userId, { nom: "Artisan", typeEntite: "personne_physique", role: "artisan" })).id,
      archiver: (id) => contactsService.archive(id),
      modifier: (id) => contactsService.update(id, { nom: "Artisan renommé" })
    },
    {
      nom: "équipement",
      table: equipements,
      creer: async () => (await equipementsService.create({ appartementId: await creerAppartement(`E-${randomUUID().slice(0, 6)}`), type: "chaudiere" })).id,
      archiver: (id) => equipementsService.archive(id),
      modifier: (id) => equipementsService.update(id, { intervalleEntretienMois: 12 })
    },
    {
      nom: "évènement du calendrier",
      table: evenementCalendrier,
      creer: async () => (await evenementsService.create(orgA.userId, { type: "autre", titre: "Visite", dateDebut: "2026-08-15" })).id,
      archiver: (id) => evenementsService.archive(id),
      modifier: (id) => evenementsService.update(id, { titre: "Visite déplacée" })
    },
    {
      nom: "garant",
      table: garants,
      creer: async () =>
        (await garantsService.create({ bailId: await creerBailBrouillon(), nom: "Durand", prenom: "Claire", typeGarantie: "personne_physique" })).id,
      archiver: (id) => garantsService.archive(id),
      modifier: (id) => garantsService.update(id, { prenom: "Clara" })
    },
    {
      nom: "sinistre",
      table: sinistre,
      creer: async () => (await sinistresService.create(orgA.userId, { type: "degat_eaux", dateDeclaration: "2026-08-15" })).id,
      archiver: (id) => sinistresService.archive(id),
      modifier: (id) => sinistresService.update(id, { dateDeclaration: "2026-08-16" })
    },
    {
      nom: "règle de catégorisation",
      table: regleCategorisation,
      creer: async () => (await reglesService.create(orgA.userId, { motCle: `edf-${randomUUID().slice(0, 6)}`, categorie: "charges_copropriete" })).id,
      archiver: (id) => reglesService.archive(id)
    },
    {
      nom: "message",
      table: messageCommunication,
      creer: async () => {
        const [ligne] = await db
          .insert(messageCommunication)
          .values({
            direction: "recu",
            emailExpediteur: "expediteur@example.com",
            emailDestinataire: "boite@example.com",
            dateMessage: new Date(),
            organisationId: orgA.organisationId
          })
          .returning();
        if (!ligne) {
          throw new Error("Échec de l'insertion du message de test");
        }
        return ligne.id;
      },
      archiver: (id) => messagesService.archiver(id)
    },
    {
      nom: "document",
      table: documents,
      creer: async () =>
        (
          await documentsService.upload(
            { entiteType: "sci", entiteId: orgA.sciId, categorie: "photo" },
            {
              originalname: "photo.pdf",
              mimetype: "application/pdf",
              buffer: Buffer.from("contenu", "utf8"),
              size: 7
            } as Express.Multer.File
          )
        ).id,
      archiver: (id) => documentsService.archiver(id),
      modifier: (id) => documentsService.update(id, { dateExpiration: "2027-01-01" })
    },
    {
      nom: "paiement",
      table: paiements,
      creer: async () =>
        (await paiementsService.create({ bailId: await creerBailBrouillon(), type: "loyer", montant: "700.00", dateEcheance: "2026-02-05" })).id,
      archiver: (id) => paiementsService.archive(id),
      modifier: (id) => paiementsService.update(id, { dateEcheance: "2026-02-06" })
    },
    {
      nom: "versement (annulation)",
      table: versements,
      creer: async () => {
        const paiement = await paiementsService.create({
          bailId: await creerBailBrouillon(),
          type: "loyer",
          montant: "700.00",
          dateEcheance: "2026-02-05"
        });
        return (await versementsService.ajouter({ paiementId: paiement.id, montant: "100.00", mode: "virement", dateVersement: "2026-02-05" })).id;
      },
      archiver: (id) => versementsService.annuler(id),
      dejaFait: "annulé",
      parentDe: async (id) => {
        const [ligne] = await db.select({ paiementId: versements.paiementId }).from(versements).where(eq(versements.id, id));
        if (!ligne) {
          throw new Error("Versement introuvable pour retrouver son paiement");
        }
        return { table: paiements, id: ligne.paiementId };
      }
    },
    {
      nom: "remboursement",
      table: remboursements,
      creer: async () =>
        (
          await remboursementsService.create({
            bailId: await creerBailBrouillon(),
            type: "trop_percu",
            montantOrigine: "50.00",
            montantRembourse: "50.00",
            dateRemboursement: "2026-03-01",
            mode: "virement"
          })
        ).id,
      archiver: (id) => remboursementsService.archive(id)
    }
  ];
  const casEach = cas.map((c) => [c.nom, c] as const);
  const casModifiables = cas.filter((c) => c.modifier).map((c) => [c.nom, c] as const);

  beforeEach(async () => {
    db = await begin();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        EncryptionModule,
        AuditModule,
        UsersModule,
        AuthModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        BauxModule,
        LocatairesModule,
        BailLocatairesModule,
        CandidatsModule,
        ContactsModule,
        EquipementsModule,
        EvenementsCalendrierModule,
        GarantsModule,
        SinistresModule,
        ReglesCategorisationModule,
        MessagerieModule,
        StorageModule,
        DocumentsModule,
        PaiementsModule,
        VersementsModule,
        RemboursementsModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    requestContextService = moduleRef.get(RequestContextService);
    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    bauxService = moduleRef.get(BauxService);
    locatairesService = moduleRef.get(LocatairesService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    candidatsService = moduleRef.get(CandidatsService);
    contactsService = moduleRef.get(ContactsService);
    equipementsService = moduleRef.get(EquipementsService);
    evenementsService = moduleRef.get(EvenementsCalendrierService);
    garantsService = moduleRef.get(GarantsService);
    sinistresService = moduleRef.get(SinistresService);
    reglesService = moduleRef.get(ReglesCategorisationService);
    messagesService = moduleRef.get(MessagesCommunicationService);
    documentsService = moduleRef.get(DocumentsService);
    paiementsService = moduleRef.get(PaiementsService);
    versementsService = moduleRef.get(VersementsService);
    remboursementsService = moduleRef.get(RemboursementsService);

    const a = await creerOrganisation("A");
    orgB = await creerOrganisation("B");
    orgA = { ...a, bienId: "", sciId: "" };
    const sci = await enA(() => scisService.create(a.userId, { nom: "SCI Fiches archivées", regimeFiscal: "IR", adresse: "1 rue de Test", codePostal: "75001", ville: "Paris" }));
    const bienFixture = await enA(() =>
      bienService.create(a.userId, {
        type: "maison",
        proprietaireType: "personne_physique",
        nomProprietaire: "Propriétaire Fiches archivées",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      })
    );
    orgA = { ...a, bienId: bienFixture.id, sciId: sci.id };
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  it.each(casEach)("%s : archiver une fiche déjà archivée → 409 « Déjà archivé le … », sans écriture", async (_nom, c) => {
    const id = await enA(() => c.creer());
    await enA(() => c.archiver(id));
    const avant = await instantane(c.table, id);
    expect(avant.archivedAt).not.toBeNull();
    const parent = c.parentDe ? await c.parentDe(id) : null;
    const avantParent = parent ? await instantane(parent.table, parent.id) : null;

    const appel = enA(() => c.archiver(id));
    await expect(appel).rejects.toThrow(ConflictException);
    await expect(appel).rejects.toThrow(messageDeja(c, avant.archivedAt as Date));
    expect(await instantane(c.table, id)).toEqual(avant);
    if (parent) {
      expect(await instantane(parent.table, parent.id)).toEqual(avantParent);
    }
  });

  it.each(casModifiables)("%s : modifier une fiche archivée → 409, sans écriture", async (_nom, c) => {
    const id = await enA(() => c.creer());
    await enA(() => c.archiver(id));
    const avant = await instantane(c.table, id);

    const appel = enA(() => (c.modifier as (id: string) => Promise<unknown>)(id));
    await expect(appel).rejects.toThrow(ConflictException);
    await expect(appel).rejects.toThrow(MESSAGE_FICHE_ARCHIVEE);
    expect(await instantane(c.table, id)).toEqual(avant);
  });

  it.each(casEach)("%s : fiche archivée d'une autre organisation → 404, pas 409", async (_nom, c) => {
    const id = await enA(() => c.creer());
    await enA(() => c.archiver(id));
    const avant = await instantane(c.table, id);

    await expect(enB(() => c.archiver(id))).rejects.toThrow(NotFoundException);
    if (c.modifier) {
      const modifier = c.modifier;
      await expect(enB(() => modifier(id))).rejects.toThrow(NotFoundException);
    }
    expect(await instantane(c.table, id)).toEqual(avant);
  });

  // Le paiement est exclu de ce test : son archive() ouvre une transaction
  // (cascade sur les versements), donc un point de sauvegarde dans la
  // transaction de test, sur UNE seule connexion — deux points de
  // sauvegarde entrelacés sur la même connexion s'annulent l'un l'autre,
  // ce qui n'arrive jamais en production (une connexion par requête). Sa
  // protection contre la course est vérifiée plus bas par une lecture
  // périmée simulée.
  it.each(casEach.filter(([, c]) => c.table !== paiements))("%s : deux archivages simultanés → un seul réussit, l'autre reçoit 409", async (_nom, c) => {
    const id = await enA(() => c.creer());
    const avant = await instantane(c.table, id);
    const parent = c.parentDe ? await c.parentDe(id) : null;
    const avantParent = parent ? await instantane(parent.table, parent.id) : null;

    const resultats = await Promise.allSettled([enA(() => c.archiver(id)), enA(() => c.archiver(id))]);
    const reussis = resultats.filter((r) => r.status === "fulfilled");
    const refus = resultats.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(reussis).toHaveLength(1);
    expect(refus).toHaveLength(1);
    expect(refus[0]?.reason).toBeInstanceOf(ConflictException);

    const apres = await instantane(c.table, id);
    expect(apres.version).toBe(avant.version + 1);
    if (parent && avantParent) {
      // Un seul recalcul du statut du paiement : celui de l'annulation
      // qui a réussi.
      expect((await instantane(parent.table, parent.id)).version).toBe(avantParent.version + 1);
    }
    expect((refus[0]?.reason as Error).message).toBe(messageDeja(c, apres.archivedAt as Date));
  });

  describe("paiement : course simulée par une lecture périmée (la condition est dans l'UPDATE)", () => {
    async function preparer() {
      const bailId = await enA(() => creerBailBrouillon());
      const paiement = await enA(() =>
        paiementsService.create({ bailId, type: "loyer", montant: "700.00", dateEcheance: "2026-02-05" })
      );
      const versement = await enA(() =>
        versementsService.ajouter({ paiementId: paiement.id, montant: "100.00", mode: "virement", dateVersement: "2026-02-05" })
      );
      // Ligne lue AVANT l'archivage : ce que verrait un second appel dont
      // le contrôle d'appartenance a eu lieu juste avant l'archivage du
      // premier.
      const [lecturePerimee] = await db.select().from(paiements).where(eq(paiements.id, paiement.id));
      await enA(() => paiementsService.archive(paiement.id));
      // Versement encore ACTIF sur l'échéance archivée (VersementsService
      // .ajouter l'accepte aujourd'hui, trou signalé hors périmètre) : si
      // le refus n'annulait pas la cascade, celui-ci serait archivé.
      const versementActif = await enA(() =>
        versementsService.ajouter({ paiementId: paiement.id, montant: "50.00", mode: "virement", dateVersement: "2026-02-06" })
      );
      const espion = vi
        .spyOn(
          paiementsService as unknown as { resoudrePaiementAvecAppartenance: (id: string) => Promise<unknown> },
          "resoudrePaiementAvecAppartenance"
        )
        .mockResolvedValueOnce(lecturePerimee);
      return { paiementId: paiement.id, versementId: versement.id, versementActifId: versementActif.id, espion };
    }

    it("archivage : 409 « Déjà archivé le … », paiement et versements inchangés", async () => {
      const { paiementId, versementId, versementActifId, espion } = await preparer();
      const avantPaiement = await instantane(paiements, paiementId);
      const avantVersement = await instantane(versements, versementId);
      const avantVersementActif = await instantane(versements, versementActifId);
      expect(avantVersementActif.archivedAt).toBeNull();

      await expect(enA(() => paiementsService.archive(paiementId))).rejects.toThrow(
        `Déjà archivé le ${dateFrancaise(avantPaiement.archivedAt as Date)}.`
      );
      expect(espion).toHaveBeenCalledTimes(1);
      expect(await instantane(paiements, paiementId)).toEqual(avantPaiement);
      expect(await instantane(versements, versementId)).toEqual(avantVersement);
      // Cascade annulée avec le refus : le versement actif reste actif.
      expect(await instantane(versements, versementActifId)).toEqual(avantVersementActif);
    });

    it("modification : 409 « Cette fiche est archivée … », paiement inchangé", async () => {
      const { paiementId, espion } = await preparer();
      const avant = await instantane(paiements, paiementId);

      await expect(enA(() => paiementsService.update(paiementId, { montant: "650.00" }))).rejects.toThrow(
        MESSAGE_FICHE_ARCHIVEE
      );
      expect(espion).toHaveBeenCalledTimes(1);
      expect(await instantane(paiements, paiementId)).toEqual(avant);
    });
  });

  // Compléments du 2026-11-22 soir : actions de modification hors PATCH.
  describe("actions hors PATCH sur une fiche archivée", () => {
    const MESSAGE_CANDIDAT_ARCHIVE = "Ce candidat est archivé : il ne peut plus être converti en locataire.";
    const MESSAGE_VERSION_ARCHIVEE = "Seule la version courante (non archivée) d'un document peut être remplacée.";

    function fichierPdf(nom: string): Express.Multer.File {
      return {
        originalname: nom,
        mimetype: "application/pdf",
        buffer: Buffer.from("nouveau contenu", "utf8"),
        size: 15
      } as Express.Multer.File;
    }

    async function nombreLocatairesOrgA(): Promise<number> {
      const [ligne] = await db.select({ n: count() }).from(locataires).where(eq(locataires.organisationId, orgA.organisationId));
      return ligne?.n ?? 0;
    }

    async function nombreVersionsSuivantes(documentId: string): Promise<number> {
      const [ligne] = await db.select({ n: count() }).from(documents).where(eq(documents.documentPrecedentId, documentId));
      return ligne?.n ?? 0;
    }

    it("conversion d'un candidat archivé → 409, aucun locataire créé, candidat inchangé", async () => {
      const id = (await enA(() => candidatsService.create(orgA.userId, { nom: "Petit", prenom: "Jules" }))).id;
      await enA(() => candidatsService.archive(id));
      const avant = await instantane(candidat, id);
      const locatairesAvant = await nombreLocatairesOrgA();

      const appel = enA(() => candidatsService.convertirEnLocataire(orgA.userId, id));
      await expect(appel).rejects.toThrow(ConflictException);
      await expect(appel).rejects.toThrow(MESSAGE_CANDIDAT_ARCHIVE);
      expect(await instantane(candidat, id)).toEqual(avant);
      expect(await nombreLocatairesOrgA()).toBe(locatairesAvant);
    });

    it("conversion d'un candidat archivé d'une autre organisation → 404, pas 409", async () => {
      const id = (await enA(() => candidatsService.create(orgA.userId, { nom: "Petit", prenom: "Jules" }))).id;
      await enA(() => candidatsService.archive(id));
      await expect(enB(() => candidatsService.convertirEnLocataire(orgB.userId, id))).rejects.toThrow(NotFoundException);
    });

    it("remplacement d'un document archivé → 409, aucune nouvelle version (contrôle déjà présent)", async () => {
      const id = await enA(() => (cas.find((c) => c.table === documents) as Cas).creer());
      await enA(() => documentsService.archiver(id));
      const avant = await instantane(documents, id);

      const appel = enA(() => documentsService.remplacerDocument(id, { categorie: "photo" }, fichierPdf("v2.pdf")));
      await expect(appel).rejects.toThrow(ConflictException);
      await expect(appel).rejects.toThrow(MESSAGE_VERSION_ARCHIVEE);
      expect(await instantane(documents, id)).toEqual(avant);
      expect(await nombreVersionsSuivantes(id)).toBe(0);
    });

    // Course : le document est archivé (archivage manuel ou autre
    // remplacement) APRÈS le contrôle `archivedAt !== null` de
    // remplacerDocument() et AVANT son écriture. Simulée en archivant le
    // document pendant l'écriture du fichier sur le stockage, qui a lieu
    // entre les deux.
    it("remplacement d'un document archivé entre le contrôle et l'écriture → 409, aucune nouvelle version", async () => {
      const id = await enA(() => (cas.find((c) => c.table === documents) as Cas).creer());
      const storage = moduleRef.get(DocumentStorageService);
      const enregistrerOriginal = storage.enregistrer.bind(storage);
      let apresArchivageConcurrent: Instantane | null = null;
      vi.spyOn(storage, "enregistrer").mockImplementationOnce(async (contenu, chemin, options) => {
        await documentsService.archiver(id);
        apresArchivageConcurrent = await instantane(documents, id);
        return enregistrerOriginal(contenu, chemin, options);
      });

      const appel = enA(() => documentsService.remplacerDocument(id, { categorie: "photo" }, fichierPdf("v2.pdf")));
      await expect(appel).rejects.toThrow(MESSAGE_VERSION_ARCHIVEE);
      expect(apresArchivageConcurrent).not.toBeNull();
      expect(await instantane(documents, id)).toEqual(apresArchivageConcurrent);
      expect(await nombreVersionsSuivantes(id)).toBe(0);
    });
  });

  it("modifier une fiche NON archivée reste possible (non-régression)", async () => {
    const id = await enA(() => locatairesService.create(orgA.userId, { nom: "Martin", prenom: "Léa" }));
    const modifie = await enA(() => locatairesService.update(id.id, { prenom: "Léonie" }));
    expect(modifie.prenom).toBe("Léonie");
  });

  it("rattachement locataire–bail : la date d'effet du congé reste modifiable sur un lien retiré (exception non tranchée)", async () => {
    const bailId = await enA(() => creerBailBrouillon());
    const locataire = await enA(() => locatairesService.create(orgA.userId, { nom: "Roux", prenom: "Inès" }));
    const lien = await enA(() => bailLocatairesService.create({ bailId, locataireId: locataire.id, role: "titulaire" }));
    await enA(() => bailLocatairesService.archive(lien.id));
    const modifie = await enA(() => bailLocatairesService.update(lien.id, { dateEffetConge: "2027-03-15" }));
    expect(modifie.dateEffetConge).toBe("2027-03-15");
  });
});
