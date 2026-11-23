import { randomBytes, randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConflictException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  baux,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  organisations,
  paiements,
  remboursements,
  utilisateurs,
  versements,
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
import { BienModule } from "../bien/bien.module";
import { BienService } from "../bien/bien.service";
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { RemboursementsModule } from "../remboursements/remboursements.module";
import { RemboursementsService } from "../remboursements/remboursements.service";
import { StorageModule } from "../storage/storage.module";
import { UsersModule } from "../users/users.module";
import { VersementsModule } from "../versements/versements.module";
import { VersementsService } from "../versements/versements.service";
import { PaiementsModule } from "./paiements.module";
import { PaiementsService } from "./paiements.service";

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 });

// Commit 3b des petites suites (compléments du 2026-11-22 soir), en VRAI
// parallèle : une seconde connexion tient le verrou du bail (SELECT … FOR
// UPDATE, celui que prennent la résiliation, le préavis et le job des
// échéances) et, pendant ce temps, archive l'échéance — exactement ce que
// fait une résiliation sur les échéances postérieures à la fin du bail.
// L'appel testé doit ATTENDRE ce verrou, puis relire l'échéance et refuser.
// Sur la connexion unique des autres tests d'intégration, rien n'attend
// jamais un verrou : d'où cette base dédiée, même principe que
// entree-papier-concurrence.integration.spec.ts (créée sur le serveur
// jetable, migrée, supprimée à la fin ; ignorée contre la base de dev).
const URL_SERVEUR = new URL(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
const SERVEUR_JETABLE = URL_SERVEUR.hostname === "localhost" && URL_SERVEUR.pathname === "/appli_immo_test";
const NOM_BASE = `appli_immo_echeances_${randomBytes(6).toString("hex")}`;
const DOSSIER_MIGRATIONS = path.resolve(__dirname, "../../../../packages/db/migrations");

const MESSAGE_FICHE_ARCHIVEE = "Cette fiche est archivée : elle ne peut plus être modifiée.";
const MESSAGE_VERSEMENT_ECHEANCE_ARCHIVEE = "Cette échéance est archivée : aucun versement ne peut y être ajouté.";
const MESSAGE_REMBOURSEMENT_ECHEANCE_ARCHIVEE =
  "Cette échéance est archivée : aucun remboursement ne peut y être rattaché.";

type Issue = { ok: true; valeur: unknown } | { ok: false; erreur: unknown };

describe.skipIf(!SERVEUR_JETABLE)(
  "Échéances : verrou du bail et statut du bail en vrai parallèle (base dédiée)",
  () => {
    const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-echeances-concurrence-${randomUUID()}`);
    process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

    const admin = createDbClient(URL_SERVEUR.toString()).$client;
    let db: Database;
    // Seconde connexion : celle qui tient le verrou du bail.
    let autre: Database;
    let moduleRef: TestingModule;
    let requestContext: RequestContextService;
    let contexte: { utilisateurId: string; organisationId: string };
    let bienId: string;

    function avecContexte<T>(fn: () => Promise<T>): Promise<T> {
      return requestContext.executerAvecContexte(contexte, fn);
    }

    async function creerBailBrouillon(): Promise<string> {
      return avecContexte(async () => {
        const appartement = await moduleRef.get(AppartementsService).create({
          bienId,
          numero: `C-${randomUUID().slice(0, 6)}`,
          type: "T2",
          nombrePiecesPrincipales: 2,
          modeChauffage: "individuel",
          modeEauChaude: "individuel"
        });
        const bail = await moduleRef.get(BauxService).create({
          appartementId: appartement.id,
          typeBail: "vide",
          dateDebut: "2026-01-01",
          loyerMensuel: "700.00"
        });
        return bail.id;
      });
    }

    // Échéance de 700 € avec un versement de 100 € (assez reçu pour un
    // remboursement de trop-perçu de 50 €).
    async function creerEcheance() {
      const bailId = await creerBailBrouillon();
      const paiementId = await avecContexte(async () => {
        const paiement = await moduleRef
          .get(PaiementsService)
          .create({ bailId, type: "loyer", montant: "700.00", dateEcheance: "2026-02-05" });
        await moduleRef.get(VersementsService).ajouter({
          paiementId: paiement.id,
          montant: "100.00",
          mode: "virement",
          dateVersement: "2026-02-05"
        });
        return paiement.id;
      });
      return { bailId, paiementId };
    }

    // Un appel du service est-il bloqué sur un verrou ? (pg_stat_activity,
    // base dédiée : seules les connexions de ce fichier y sont.)
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

    // Tient le verrou du bail sur la seconde connexion, lance `appel`, note
    // s'il a attendu le verrou ou s'il a abouti sans l'attendre, puis exécute
    // `pendantLeVerrou` (sous le verrou) et relâche.
    async function sousLeVerrouDuBail(
      bailId: string,
      appel: () => Promise<unknown>,
      pendantLeVerrou: (tx: Database) => Promise<void>
    ): Promise<{ aAttendu: boolean; issue: Issue }> {
      let relacher!: () => void;
      const relache = new Promise<void>((resolve) => {
        relacher = resolve;
      });
      let signalerVerrouPris!: () => void;
      const verrouPris = new Promise<void>((resolve) => {
        signalerVerrouPris = resolve;
      });
      const transaction = autre.transaction(async (tx) => {
        await tx.select({ id: baux.id }).from(baux).where(eq(baux.id, bailId)).for("update");
        signalerVerrouPris();
        await relache;
        await pendantLeVerrou(tx as unknown as Database);
      });
      await verrouPris;

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
      relacher();
      await transaction;
      return { aAttendu, issue: await issue };
    }

    // Ce que fait la résiliation sur une échéance postérieure à la fin.
    function archiverEcheance(paiementId: string) {
      return async (tx: Database) => {
        await tx.update(paiements).set({ archivedAt: new Date() }).where(eq(paiements.id, paiementId));
        await tx.update(versements).set({ archivedAt: new Date() }).where(eq(versements.paiementId, paiementId));
      };
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
          BienModule,
          AppartementsModule,
          BauxModule,
          StorageModule,
          PaiementsModule,
          VersementsModule,
          RemboursementsModule
        ]
      })
        .overrideProvider(DATABASE_CONNECTION)
        .useValue(db)
        .compile();
      requestContext = moduleRef.get(RequestContextService);

      const [organisation] = await db
        .insert(organisations)
        .values({ type: "particulier", nom: "Échéances concurrence" })
        .returning();
      const [utilisateur] = await db
        .insert(utilisateurs)
        .values({
          organisationId: organisation!.id,
          email: `echeances-concurrence-${randomUUID()}@example.com`,
          nom: "Test",
          prenom: "Concurrence",
          motDePasseHash: "peu-importe-pour-ce-test",
          statut: "actif"
        })
        .returning();
      contexte = { utilisateurId: utilisateur!.id, organisationId: organisation!.id };
      const bien = await avecContexte(() =>
        moduleRef.get(BienService).create(contexte.utilisateurId, {
          type: "maison",
          proprietaireType: "personne_physique",
          nomProprietaire: "Propriétaire Concurrence",
          adresse: "1 rue du Verrou",
          codePostal: "69001",
          ville: "Lyon"
        })
      );
      bienId = bien.id;
    });

    afterAll(async () => {
      await moduleRef?.close();
      await db?.$client.end({ timeout: 5 });
      await autre?.$client.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${NOM_BASE}" WITH (FORCE)`);
      await admin.end();
      await rm(storageDirTest, { recursive: true, force: true });
    });

    it("archivage manuel d'une échéance : attend le verrou du bail, puis 409 « Déjà archivé » si la résiliation l'a archivée", async () => {
      const { bailId, paiementId } = await creerEcheance();
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () => avecContexte(() => moduleRef.get(PaiementsService).archive(paiementId)),
        archiverEcheance(paiementId)
      );
      expect(aAttendu).toBe(true);
      expect(messageDe(issue)).toMatch(/^Déjà archivé le \d{2}\/\d{2}\/\d{4}\.$/);
      expect(!issue.ok && issue.erreur instanceof ConflictException).toBe(true);
    });

    it("modification manuelle d'une échéance : attend le verrou du bail, puis 409 si la résiliation l'a archivée", async () => {
      const { bailId, paiementId } = await creerEcheance();
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () => avecContexte(() => moduleRef.get(PaiementsService).update(paiementId, { montant: "650.00" })),
        archiverEcheance(paiementId)
      );
      expect(aAttendu).toBe(true);
      expect(messageDe(issue)).toBe(MESSAGE_FICHE_ARCHIVEE);
      const [apres] = await db.select().from(paiements).where(eq(paiements.id, paiementId));
      expect(apres?.montant).toBe("700.00");
    });

    it("ajout d'un versement : attend le verrou du bail, puis 409 si l'échéance a été archivée, aucun versement actif", async () => {
      const { bailId, paiementId } = await creerEcheance();
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () =>
          avecContexte(() =>
            moduleRef.get(VersementsService).ajouter({
              paiementId,
              montant: "50.00",
              mode: "virement",
              dateVersement: "2026-02-06"
            })
          ),
        archiverEcheance(paiementId)
      );
      expect(aAttendu).toBe(true);
      expect(messageDe(issue)).toBe(MESSAGE_VERSEMENT_ECHEANCE_ARCHIVEE);
      const lignes = await db.select().from(versements).where(eq(versements.paiementId, paiementId));
      expect(lignes.filter((v) => v.archivedAt === null)).toHaveLength(0);
    });

    it("remboursement lié à l'échéance : attend le verrou du bail, puis 409 si l'échéance a été archivée, aucun remboursement", async () => {
      const { bailId, paiementId } = await creerEcheance();
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () =>
          avecContexte(() =>
            moduleRef.get(RemboursementsService).create({
              bailId,
              paiementId,
              type: "trop_percu",
              montantOrigine: "50.00",
              montantRembourse: "50.00",
              dateRemboursement: "2026-03-01",
              mode: "virement"
            })
          ),
        archiverEcheance(paiementId)
      );
      expect(aAttendu).toBe(true);
      expect(messageDe(issue)).toBe(MESSAGE_REMBOURSEMENT_ECHEANCE_ARCHIVEE);
      expect(await db.select().from(remboursements).where(eq(remboursements.paiementId, paiementId))).toHaveLength(0);
    });

    // Plafond « total remboursé ≤ reçu » (revue du commit 3b, point 2) :
    // calculé hors verrou, deux créations simultanées le passaient toutes
    // les deux. Plusieurs essais : l'entrelacement n'est pas forcé (sur
    // l'ancien code, l'essai 0 est passé et l'essai 1 a échoué).
    it("deux remboursements simultanés de 60 € sur 100 € reçus : un seul réussit, l'autre refusé par le plafond, à chaque essai", async () => {
      for (let essai = 0; essai < 5; essai++) {
        const { bailId, paiementId } = await creerEcheance();
        const creer = () =>
          avecContexte(() =>
            moduleRef.get(RemboursementsService).create({
              bailId,
              paiementId,
              type: "trop_percu",
              montantOrigine: "60.00",
              montantRembourse: "60.00",
              dateRemboursement: "2026-03-01",
              mode: "virement"
            })
          );
        const resultats = await Promise.allSettled([creer(), creer()]);
        const refus = resultats.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(resultats.filter((r) => r.status === "fulfilled"), `essai ${essai}`).toHaveLength(1);
        expect(refus, `essai ${essai}`).toHaveLength(1);
        expect((refus[0]!.reason as Error).message, `essai ${essai}`).toBe(
          "Le total des remboursements ne peut pas dépasser le montant réellement reçu sur ce paiement."
        );
        expect(
          await db.select().from(remboursements).where(eq(remboursements.paiementId, paiementId)),
          `essai ${essai}`
        ).toHaveLength(1);
      }
    });

    // Annulation d'un versement (revue du commit 3b, point 3) : pendant
    // qu'une autre écriture tient le bail (ici, le montant de l'échéance
    // passe de 700 € à 100 €, comme un prorata de résiliation), l'annulation
    // doit attendre puis recalculer le statut sur les données validées.
    // Échéance : 700 €, deux versements de 100 € ; on annule le second.
    // Données validées à la fin : 100 € dus, 100 € reçus → « paye ».
    it("annulation d'un versement pendant un changement de montant : attend le verrou, statut final cohérent", async () => {
      const { bailId, paiementId } = await creerEcheance();
      const versementsService = moduleRef.get(VersementsService);
      const second = await avecContexte(() =>
        versementsService.ajouter({ paiementId, montant: "100.00", mode: "virement", dateVersement: "2026-02-06" })
      );
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () => avecContexte(() => versementsService.annuler(second.id)),
        async (tx) => {
          await tx.update(paiements).set({ montant: "100.00" }).where(eq(paiements.id, paiementId));
        }
      );
      expect(aAttendu).toBe(true);
      expect(issue.ok).toBe(true);
      const [echeance] = await db.select().from(paiements).where(eq(paiements.id, paiementId));
      expect(echeance?.montant).toBe("100.00");
      expect(echeance?.statut).toBe("paye");
    });

    it("deux annulations simultanées du même versement : une seule réussit, l'autre reçoit 409 « Déjà annulé »", async () => {
      const { paiementId } = await creerEcheance();
      const [versement] = await db.select().from(versements).where(eq(versements.paiementId, paiementId));
      const service = moduleRef.get(VersementsService);
      const [avant] = await db.select().from(paiements).where(eq(paiements.id, paiementId));
      const resultats = await Promise.allSettled([
        avecContexte(() => service.annuler(versement!.id)),
        avecContexte(() => service.annuler(versement!.id))
      ]);
      const refus = resultats.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(refus).toHaveLength(1);
      expect((refus[0]!.reason as Error).message).toMatch(/^Déjà annulé le \d{2}\/\d{2}\/\d{4}\.$/);
      const [echeance] = await db.select().from(paiements).where(eq(paiements.id, paiementId));
      expect(echeance?.statut).toBe("impaye");
      // Un seul recalcul : celui de l'annulation qui a réussi.
      expect(echeance?.version).toBe(avant!.version + 1);
    });

    // Commit 5, remarque 7 : l'annulation contrôle « remboursé ≤ reçu
    // restant » sous le verrou du bail. Un remboursement en cours de
    // création (sous ce même verrou) est donc vu.
    it("annulation d'un versement pendant la création d'un remboursement : attend le verrou, puis 409, versement actif", async () => {
      const { bailId, paiementId } = await creerEcheance();
      const [versement] = await db.select().from(versements).where(eq(versements.paiementId, paiementId));
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () => avecContexte(() => moduleRef.get(VersementsService).annuler(versement!.id)),
        async (tx) => {
          await tx.insert(remboursements).values({
            bailId,
            paiementId,
            type: "trop_percu",
            montantOrigine: "60.00",
            montantRembourse: "60.00",
            dateRemboursement: "2026-03-01",
            mode: "virement"
          });
        }
      );
      expect(aAttendu).toBe(true);
      expect(messageDe(issue)).toBe(
        "Impossible d'annuler ce versement : 60.00 € ont déjà été remboursés sur cette échéance, il n'en resterait que 0.00 € reçus. Archivez d'abord le remboursement."
      );
      const [apres] = await db.select().from(versements).where(eq(versements.id, versement!.id));
      expect(apres?.archivedAt).toBeNull();
    });

    // Sens inverse (déjà fermé au commit 3b : plafond relu sous verrou) :
    // non-régression. La seconde connexion archive le versement par un
    // UPDATE brut sous le verrou du bail (elle ne passe pas par annuler()) :
    // ce test ne vérifie que la relecture du plafond à la création.
    it("création d'un remboursement pendant que le versement est archivé sous le verrou : attend, puis 409 plafond", async () => {
      const { bailId, paiementId } = await creerEcheance();
      const [versement] = await db.select().from(versements).where(eq(versements.paiementId, paiementId));
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () =>
          avecContexte(() =>
            moduleRef.get(RemboursementsService).create({
              bailId,
              paiementId,
              type: "trop_percu",
              montantOrigine: "60.00",
              montantRembourse: "60.00",
              dateRemboursement: "2026-03-01",
              mode: "virement"
            })
          ),
        async (tx) => {
          await tx.update(versements).set({ archivedAt: new Date() }).where(eq(versements.id, versement!.id));
        }
      );
      expect(aAttendu).toBe(true);
      expect(messageDe(issue)).toBe(
        "Le total des remboursements ne peut pas dépasser le montant réellement reçu sur ce paiement."
      );
    });

    // Compléments du 2026-11-23 : l'archivage d'une échéance relit ses
    // remboursements actifs sous le verrou du bail. Un remboursement en
    // cours de création (sous ce même verrou) est donc vu : 409, rien
    // d'archivé. Le sens inverse (création pendant l'archivage) est déjà
    // couvert plus haut : « remboursement lié à l'échéance : attend le
    // verrou du bail, puis 409 si l'échéance a été archivée ».
    it("archivage d'une échéance pendant la création d'un remboursement : attend le verrou, puis 409, échéance et versement actifs", async () => {
      const { bailId, paiementId } = await creerEcheance();
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () => avecContexte(() => moduleRef.get(PaiementsService).archive(paiementId)),
        async (tx) => {
          await tx.insert(remboursements).values({
            bailId,
            paiementId,
            type: "trop_percu",
            montantOrigine: "60.00",
            montantRembourse: "60.00",
            dateRemboursement: "2026-03-01",
            mode: "virement"
          });
        }
      );
      expect(aAttendu).toBe(true);
      expect(messageDe(issue)).toBe(
        "Impossible d'archiver cette échéance : elle porte 1 remboursement (60.00 €). Archivez d'abord le remboursement."
      );
      const [echeance] = await db.select().from(paiements).where(eq(paiements.id, paiementId));
      expect(echeance?.archivedAt).toBeNull();
      const lesVersements = await db.select().from(versements).where(eq(versements.paiementId, paiementId));
      expect(lesVersements.filter((v) => v.archivedAt === null)).toHaveLength(1);
    });

    it("deux archivages simultanés de la même échéance : un seul réussit, l'autre reçoit 409", async () => {
      const { paiementId } = await creerEcheance();
      const service = moduleRef.get(PaiementsService);
      const resultats = await Promise.allSettled([
        avecContexte(() => service.archive(paiementId)),
        avecContexte(() => service.archive(paiementId))
      ]);
      const refus = resultats.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(resultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(refus).toHaveLength(1);
      expect(refus[0]!.reason).toBeInstanceOf(ConflictException);
    });

    // Archivage d'un bail brouillon pendant que son activation tient la
    // ligne : le statut lu avant (« brouillon ») n'est plus vrai au moment de
    // l'UPDATE. Sans le statut dans la condition de l'UPDATE, un bail ACTIF
    // était archivé.
    it("archivage d'un bail brouillon activé entre-temps : 409, le bail reste actif et non archivé", async () => {
      const bailId = await creerBailBrouillon();
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () => avecContexte(() => moduleRef.get(BauxService).archive(bailId)),
        async (tx) => {
          await tx.update(baux).set({ statut: "actif" }).where(eq(baux.id, bailId));
        }
      );
      expect(aAttendu).toBe(true);
      expect(messageDe(issue)).toBe(
        "Un bail actif ou en préavis doit d'abord être résilié avant d'être archivé (statut actuel : actif)."
      );
      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.statut).toBe("actif");
      expect(bail?.archivedAt).toBeNull();
    });

    // Sens inverse (revue financial-logic-reviewer du commit 3b) :
    // l'archivage valide pendant que l'activation a déjà lu « brouillon ».
    // Sans verrou à la lecture d'activer(), l'activation réécrivait
    // statut = actif sur un bail archivé, puis créait caution et échéance.
    it("activation d'un bail archivé entre-temps : attend le verrou, puis 409, aucune échéance créée", async () => {
      const bailId = await avecContexte(async () => {
        const appartement = await moduleRef.get(AppartementsService).create({
          bienId,
          numero: `A-${randomUUID().slice(0, 6)}`,
          type: "T2",
          nombrePiecesPrincipales: 2,
          modeChauffage: "individuel",
          modeEauChaude: "individuel"
        });
        const bail = await moduleRef.get(BauxService).create({
          appartementId: appartement.id,
          typeBail: "vide",
          dateDebut: "2026-01-01",
          loyerMensuel: "700.00",
          jourEcheance: 5
        });
        return bail.id;
      });
      const { aAttendu, issue } = await sousLeVerrouDuBail(
        bailId,
        () => avecContexte(() => moduleRef.get(BauxService).activer(bailId)),
        async (tx) => {
          await tx.update(baux).set({ statut: "archive", archivedAt: new Date() }).where(eq(baux.id, bailId));
        }
      );
      expect(aAttendu).toBe(true);
      expect(messageDe(issue)).toBe("Seul un bail en brouillon peut être activé (statut actuel : archive).");
      const [bail] = await db.select().from(baux).where(eq(baux.id, bailId));
      expect(bail?.statut).toBe("archive");
      expect(await db.select().from(paiements).where(eq(paiements.bailId, bailId))).toHaveLength(0);
    });
  }
);
