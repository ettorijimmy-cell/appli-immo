import { randomBytes, randomUUID } from "crypto";
import path from "path";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  appartements,
  baux,
  bien,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  organisations,
  scis,
  utilisateurs,
  type Database
} from "db";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppartementsModule } from "../appartements/appartements.module";
import { AppartementsService } from "../appartements/appartements.service";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { BauxModule } from "../baux/baux.module";
import { BauxService } from "../baux/baux.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { UsersModule } from "../users/users.module";
import { BienModule } from "./bien.module";
import { BienService } from "./bien.service";

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 });

// Commit 4 des petites suites (décision 5), en VRAI parallèle : un
// appartement (ou un bien) est en cours de création — son INSERT est fait
// sur une seconde connexion, pas encore validé — pendant l'archivage de son
// bien (ou de sa SCI). L'archivage doit attendre la fin de cette création,
// puis la voir et refuser. Mécanisme : l'archivage lit le bien (la SCI) en
// SELECT … FOR UPDATE, qui attend le verrou de clé (FOR KEY SHARE) que
// l'INSERT de l'enfant pose sur la ligne parente par sa clé étrangère.
// Même principe de base dédiée que entree-papier-concurrence (serveur
// jetable seulement, ignoré contre la base de dev).
const URL_SERVEUR = new URL(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
const SERVEUR_JETABLE = URL_SERVEUR.hostname === "localhost" && URL_SERVEUR.pathname === "/appli_immo_test";
const NOM_BASE = `appli_immo_bien_sci_${randomBytes(6).toString("hex")}`;
const DOSSIER_MIGRATIONS = path.resolve(__dirname, "../../../../packages/db/migrations");

type Issue = { ok: true; valeur: unknown } | { ok: false; erreur: unknown };

describe.skipIf(!SERVEUR_JETABLE)("Archivage bien / SCI pendant la création d'un enfant, en vrai parallèle (base dédiée)", () => {
  const admin = createDbClient(URL_SERVEUR.toString()).$client;
  let db: Database;
  let autre: Database;
  let moduleRef: TestingModule;
  let requestContext: RequestContextService;
  let contexte: { utilisateurId: string; organisationId: string };

  function avecContexte<T>(fn: () => Promise<T>): Promise<T> {
    return requestContext.executerAvecContexte(contexte, fn);
  }

  async function attendreUnBlocage(): Promise<boolean> {
    for (let i = 0; i < 60; i++) {
      const lignes = await admin.unsafe(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = '${NOM_BASE}' AND wait_event_type = 'Lock'`
      );
      if ((lignes[0] as { n: number } | undefined)?.n) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  // Exécute `creationEnCours` dans une transaction de la seconde connexion,
  // lance `appel` pendant qu'elle n'est pas validée, note si l'appel a
  // attendu, puis valide la transaction.
  async function pendantUneCreation(
    creationEnCours: (tx: Database) => Promise<void>,
    appel: () => Promise<unknown>
  ): Promise<{ aAttendu: boolean; issue: Issue }> {
    let valider!: () => void;
    const validation = new Promise<void>((resolve) => {
      valider = resolve;
    });
    let signalerInsere!: () => void;
    const insere = new Promise<void>((resolve) => {
      signalerInsere = resolve;
    });
    const transaction = autre.transaction(async (tx) => {
      await creationEnCours(tx as unknown as Database);
      signalerInsere();
      await validation;
    });
    await insere;

    let termine = false;
    const issue: Promise<Issue> = appel().then(
      (valeur) => {
        termine = true;
        return { ok: true, valeur };
      },
      (erreur: unknown) => {
        termine = true;
        return { ok: false, erreur };
      }
    );
    const bloque = await Promise.race([attendreUnBlocage(), issue.then(() => false)]);
    const aAttendu = bloque && !termine;
    valider();
    await transaction;
    return { aAttendu, issue: await issue };
  }

  function messageDe(issue: Issue): string {
    if (issue.ok) {
      return "(aucune erreur : l'appel a abouti)";
    }
    return issue.erreur instanceof Error ? issue.erreur.message : String(issue.erreur);
  }

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${NOM_BASE}"`);
    const urlBase = new URL(URL_SERVEUR.toString());
    urlBase.pathname = `/${NOM_BASE}`;
    db = createDbClient(urlBase.toString());
    autre = createDbClient(urlBase.toString());
    await migrate(db, { migrationsFolder: DOSSIER_MIGRATIONS });

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
        BauxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();
    requestContext = moduleRef.get(RequestContextService);

    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: "Bien SCI concurrence" }).returning();
    const [utilisateur] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `bien-sci-concurrence-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: "Concurrence",
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    contexte = { utilisateurId: utilisateur!.id, organisationId: organisation!.id };
  });

  afterAll(async () => {
    await moduleRef?.close();
    await db?.$client.end({ timeout: 5 });
    await autre?.$client.end({ timeout: 5 });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${NOM_BASE}" WITH (FORCE)`);
    await admin.end();
  });

  it("appartement en cours de création pendant l'archivage du bien : l'archivage attend, puis 409", async () => {
    const bienCree = await avecContexte(() =>
      moduleRef.get(BienService).create(contexte.utilisateurId, {
        type: "maison",
        proprietaireType: "personne_physique",
        nomProprietaire: "Propriétaire",
        adresse: "1 rue du Verrou",
        codePostal: "69001",
        ville: "Lyon"
      })
    );
    const { aAttendu, issue } = await pendantUneCreation(
      async (tx) => {
        await tx.insert(appartements).values({
          bienId: bienCree.id,
          numero: "1",
          type: "T2",
          nombrePiecesPrincipales: 2,
          modeChauffage: "individuel",
          modeEauChaude: "individuel"
        });
      },
      () => avecContexte(() => moduleRef.get(BienService).archive(bienCree.id))
    );
    expect(aAttendu).toBe(true);
    expect(messageDe(issue)).toBe("Archivez d'abord l'appartement de ce bien.");
    const [ligne] = await db.select().from(bien).where(eq(bien.id, bienCree.id));
    expect(ligne?.archivedAt).toBeNull();
  });

  it("bien en cours de création dans la SCI pendant son archivage : l'archivage attend, puis 409", async () => {
    const sci = await avecContexte(() =>
      moduleRef.get(ScisService).create(contexte.utilisateurId, {
        nom: "SCI Concurrence",
        regimeFiscal: "IR",
        adresse: "1 rue du Verrou",
        codePostal: "69001",
        ville: "Lyon"
      })
    );
    const { aAttendu, issue } = await pendantUneCreation(
      async (tx) => {
        await tx.insert(bien).values({
          type: "maison",
          proprietaireType: "sci",
          sciId: sci.id,
          organisationId: contexte.organisationId,
          adresse: "2 rue du Verrou",
          codePostal: "69001",
          ville: "Lyon",
          typeHabitat: "individuel",
          regimeJuridique: "mono_propriete"
        });
      },
      () => avecContexte(() => moduleRef.get(ScisService).archive(sci.id))
    );
    expect(aAttendu).toBe(true);
    expect(messageDe(issue)).toBe("Archivez d'abord le bien de cette SCI.");
    const [ligne] = await db.select().from(scis).where(eq(scis.id, sci.id));
    expect(ligne?.archivedAt).toBeNull();
  });

  // Repris du test sur connexion unique de fiches-archivees (où la
  // transaction d'archive() fausserait le résultat).
  it("deux archivages simultanés d'un bien vide : un seul réussit, l'autre reçoit « Déjà archivé le … »", async () => {
    const bienCree = await avecContexte(() =>
      moduleRef.get(BienService).create(contexte.utilisateurId, {
        type: "maison",
        proprietaireType: "personne_physique",
        nomProprietaire: "Propriétaire",
        adresse: "3 rue du Verrou",
        codePostal: "69001",
        ville: "Lyon"
      })
    );
    const service = moduleRef.get(BienService);
    const resultats = await Promise.allSettled([
      avecContexte(() => service.archive(bienCree.id)),
      avecContexte(() => service.archive(bienCree.id))
    ]);
    const refus = resultats.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(refus).toHaveLength(1);
    expect((refus[0]!.reason as Error).message).toMatch(/^Déjà archivé le \d{2}\/\d{2}\/\d{4}\.$/);
    const [ligne] = await db.select().from(bien).where(eq(bien.id, bienCree.id));
    expect(ligne?.version).toBe(bienCree.version + 1);
  });

  it("deux archivages simultanés d'une SCI vide : un seul réussit, l'autre reçoit « Déjà archivé le … »", async () => {
    const sci = await avecContexte(() =>
      moduleRef.get(ScisService).create(contexte.utilisateurId, {
        nom: "SCI Double archivage",
        regimeFiscal: "IR",
        adresse: "1 rue du Verrou",
        codePostal: "69001",
        ville: "Lyon"
      })
    );
    const service = moduleRef.get(ScisService);
    const resultats = await Promise.allSettled([
      avecContexte(() => service.archive(sci.id)),
      avecContexte(() => service.archive(sci.id))
    ]);
    const refus = resultats.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(refus).toHaveLength(1);
    expect((refus[0]!.reason as Error).message).toMatch(/^Déjà archivé le \d{2}\/\d{2}\/\d{4}\.$/);
    const [ligne] = await db.select().from(scis).where(eq(scis.id, sci.id));
    expect(ligne?.version).toBe(sci.version + 1);
  });

  // --- Compléments du 2026-11-22 (commit 4) : créations dans un parent en
  // cours d'archivage, et archivage d'un appartement / activation d'un bail.
  // La seconde connexion joue l'archivage (ou l'activation) : elle verrouille
  // la ligne comme le vrai code, écrit, et ne valide qu'après l'appel testé.

  function creerBienNomPropre(adresse: string) {
    return avecContexte(() =>
      moduleRef.get(BienService).create(contexte.utilisateurId, {
        type: "maison",
        proprietaireType: "personne_physique",
        nomProprietaire: "Propriétaire",
        adresse,
        codePostal: "69001",
        ville: "Lyon"
      })
    );
  }

  function creerAppartementDans(bienId: string) {
    return avecContexte(() =>
      moduleRef.get(AppartementsService).create({
        bienId,
        numero: `A-${randomUUID().slice(0, 6)}`,
        type: "T2",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      })
    );
  }

  function creerBailBrouillonSur(appartementId: string) {
    return avecContexte(() =>
      moduleRef.get(BauxService).create({
        appartementId,
        typeBail: "vide",
        dateDebut: "2026-01-01",
        loyerMensuel: "700.00",
        jourEcheance: 5
      })
    );
  }

  it("création d'un appartement pendant l'archivage de son bien : attend, puis 409, aucun appartement", async () => {
    const bienCree = await creerBienNomPropre("10 rue du Verrou");
    const { aAttendu, issue } = await pendantUneCreation(
      async (tx) => {
        await tx.select({ id: bien.id }).from(bien).where(eq(bien.id, bienCree.id)).for("update");
        await tx.update(bien).set({ statut: "archive", archivedAt: new Date() }).where(eq(bien.id, bienCree.id));
      },
      () => creerAppartementDans(bienCree.id)
    );
    expect(aAttendu).toBe(true);
    expect(messageDe(issue)).toBe(
      "Ce bien est archivé : aucun appartement ne peut y être ajouté tant qu'il n'est pas désarchivé."
    );
    expect(await db.select().from(appartements).where(eq(appartements.bienId, bienCree.id))).toHaveLength(0);
  });

  it("création d'un bien dans une SCI pendant son archivage : attend, puis 409, aucun bien", async () => {
    const sci = await avecContexte(() =>
      moduleRef.get(ScisService).create(contexte.utilisateurId, {
        nom: "SCI Création concurrente",
        regimeFiscal: "IR",
        adresse: "1 rue du Verrou",
        codePostal: "69001",
        ville: "Lyon"
      })
    );
    const { aAttendu, issue } = await pendantUneCreation(
      async (tx) => {
        await tx.select({ id: scis.id }).from(scis).where(eq(scis.id, sci.id)).for("update");
        await tx.update(scis).set({ statut: "archive", archivedAt: new Date() }).where(eq(scis.id, sci.id));
      },
      () =>
        avecContexte(() =>
          moduleRef.get(BienService).create(contexte.utilisateurId, {
            type: "maison",
            proprietaireType: "sci",
            sciId: sci.id,
            adresse: "11 rue du Verrou",
            codePostal: "69001",
            ville: "Lyon"
          })
        )
    );
    expect(aAttendu).toBe(true);
    expect(messageDe(issue)).toBe(
      "Cette SCI est archivée : aucun bien ne peut y être rattaché tant qu'elle n'est pas désarchivée."
    );
    expect(await db.select().from(bien).where(eq(bien.sciId, sci.id))).toHaveLength(0);
  });

  it("création d'un bail pendant l'archivage de son appartement : attend, puis 409, aucun bail", async () => {
    const appartement = await creerAppartementDans((await creerBienNomPropre("12 rue du Verrou")).id);
    const { aAttendu, issue } = await pendantUneCreation(
      async (tx) => {
        await tx.select({ id: appartements.id }).from(appartements).where(eq(appartements.id, appartement.id)).for("update");
        await tx
          .update(appartements)
          .set({ statut: "archive", archivedAt: new Date() })
          .where(eq(appartements.id, appartement.id));
      },
      () => creerBailBrouillonSur(appartement.id)
    );
    expect(aAttendu).toBe(true);
    expect(messageDe(issue)).toBe(
      "Cet appartement est archivé : aucun bail ne peut y être créé tant qu'il n'est pas désarchivé."
    );
    expect(await db.select().from(baux).where(eq(baux.appartementId, appartement.id))).toHaveLength(0);
  });

  it("activation d'un bail pendant l'archivage de son appartement : attend, puis 409, le bail reste en brouillon", async () => {
    const appartement = await creerAppartementDans((await creerBienNomPropre("13 rue du Verrou")).id);
    const bail = await creerBailBrouillonSur(appartement.id);
    const { aAttendu, issue } = await pendantUneCreation(
      async (tx) => {
        await tx.select({ id: appartements.id }).from(appartements).where(eq(appartements.id, appartement.id)).for("update");
        await tx
          .update(appartements)
          .set({ statut: "archive", archivedAt: new Date() })
          .where(eq(appartements.id, appartement.id));
      },
      () => avecContexte(() => moduleRef.get(BauxService).activer(bail.id))
    );
    expect(aAttendu).toBe(true);
    expect(messageDe(issue)).toBe("Impossible d'activer ce bail : l'appartement n'est pas vacant (statut actuel : archive).");
    const [ligne] = await db.select().from(baux).where(eq(baux.id, bail.id));
    expect(ligne?.statut).toBe("brouillon");
  });

  it("archivage d'un appartement pendant l'activation d'un de ses baux : attend, puis 409, l'appartement reste non archivé", async () => {
    const appartement = await creerAppartementDans((await creerBienNomPropre("14 rue du Verrou")).id);
    const bail = await creerBailBrouillonSur(appartement.id);
    const { aAttendu, issue } = await pendantUneCreation(
      async (tx) => {
        // Comme activer() : le bail d'abord, puis l'appartement.
        await tx.select({ id: baux.id }).from(baux).where(eq(baux.id, bail.id)).for("update");
        await tx
          .select({ id: appartements.id })
          .from(appartements)
          .where(eq(appartements.id, appartement.id))
          .for("no key update");
        await tx.update(baux).set({ statut: "actif" }).where(eq(baux.id, bail.id));
        await tx.update(appartements).set({ statut: "loue" }).where(eq(appartements.id, appartement.id));
      },
      () => avecContexte(() => moduleRef.get(AppartementsService).archive(appartement.id))
    );
    expect(aAttendu).toBe(true);
    expect(messageDe(issue)).toBe(
      "Cet appartement a un bail actif ou en préavis. Résiliez d'abord ce bail, puis archivez l'appartement."
    );
    const [ligne] = await db.select().from(appartements).where(eq(appartements.id, appartement.id));
    expect(ligne?.archivedAt).toBeNull();
  });

  // Repris du test sur connexion unique de fiches-archivees (archive() de
  // l'appartement ouvre désormais une transaction, ligne verrouillée).
  it("deux archivages simultanés d'un appartement vide : un seul réussit, l'autre reçoit « Déjà archivé le … »", async () => {
    const appartement = await creerAppartementDans((await creerBienNomPropre("15 rue du Verrou")).id);
    const service = moduleRef.get(AppartementsService);
    const resultats = await Promise.allSettled([
      avecContexte(() => service.archive(appartement.id)),
      avecContexte(() => service.archive(appartement.id))
    ]);
    const refus = resultats.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(refus).toHaveLength(1);
    expect((refus[0]!.reason as Error).message).toMatch(/^Déjà archivé le \d{2}\/\d{2}\/\d{4}\.$/);
  });
});
