import { randomBytes, randomUUID } from "crypto";
import { rm } from "fs/promises";
import os from "os";
import path from "path";
import { ConflictException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  etatDesLieuxEntreePapier,
  etatDesLieuxSignature,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { CommonModule } from "../common/common.module";
import { RequestContextService } from "../common/request-context";
import { EncryptionModule } from "../crypto/encryption.module";
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { DocumentsModule } from "../documents/documents.module";
import { EtatsDesLieuxSignatureModule } from "../etats-des-lieux-signature/etats-des-lieux-signature.module";
import { EtatsDesLieuxSignatureService } from "../etats-des-lieux-signature/etats-des-lieux-signature.service";
import { EtatsDesLieuxModule } from "../etats-des-lieux/etats-des-lieux.module";
import { EtatsDesLieuxService } from "../etats-des-lieux/etats-des-lieux.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { UsersModule } from "../users/users.module";
import { EtatDesLieuxEntreePapierModule } from "./etat-des-lieux-entree-papier.module";
import { EtatDesLieuxEntreePapierService } from "./etat-des-lieux-entree-papier.service";

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 });

// Exclusion mutuelle en VRAI parallèle (2026-11-06). Les autres tests
// d'intégration partagent une seule connexion par test (transaction annulée
// à la fin) : deux appels « simultanés » s'y entrelacent sur la même
// transaction, sans jamais attendre un verrou. Ici, deux connexions
// distinctes se disputent réellement le verrou FOR UPDATE de l'en-tête.
//
// Il faut donc des données VALIDÉES, que les triggers interdisent ensuite
// d'effacer. Pour ne jamais en laisser derrière soi, ni troubler les tests
// qui comptent sur une base vide (requête système du rattrapage PDF), ce
// fichier crée sa PROPRE base sur le même serveur, y applique les
// migrations, puis la supprime. Uniquement sur un serveur jetable
// (base appli_immo_test sur localhost : CI et pnpm test:integration:clean) ;
// ignoré contre la base de dev.
const URL_SERVEUR = new URL(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
const SERVEUR_JETABLE = URL_SERVEUR.hostname === "localhost" && URL_SERVEUR.pathname === "/appli_immo_test";
const NOM_BASE = `appli_immo_concurrence_${randomBytes(6).toString("hex")}`;
const DOSSIER_MIGRATIONS = path.resolve(__dirname, "../../../../packages/db/migrations");

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SCAN = { nomFichier: "entree.pdf", contenu: Buffer.from("%PDF-1.4\n% concurrence\n%%EOF\n") };

describe.skipIf(!SERVEUR_JETABLE)("Entrée papier — exclusion mutuelle en vrai parallèle (base dédiée)", () => {
  const storageDirTest = path.join(os.tmpdir(), `appli-immo-test-concurrence-${randomUUID()}`);
  process.env["DOCUMENTS_STORAGE_DIR"] = storageDirTest;

  // Connexion à la base du serveur (jamais à la base créée), pour CREATE/DROP.
  const admin = createDbClient(URL_SERVEUR.toString()).$client;
  let db: Database;
  let moduleRef: TestingModule;
  let requestContext: RequestContextService;
  let entreePapier: EtatDesLieuxEntreePapierService;
  let signature: EtatsDesLieuxSignatureService;
  let contexte: { utilisateurId: string; organisationId: string };

  function avecContexte<T>(fn: () => T): T {
    return requestContext.executerAvecContexte(contexte, fn);
  }

  async function creerDossier() {
    return avecContexte(async () => {
      const sci = await moduleRef.get(ScisService).create(contexte.utilisateurId, {
        nom: "SCI Concurrence",
        regimeFiscal: "IR",
        adresse: "1 rue de Test",
        codePostal: "75001",
        ville: "Paris"
      });
      const bien = await moduleRef.get(BienService).create(contexte.utilisateurId, {
        type: "immeuble",
        proprietaireType: "sci",
        sciId: sci.id,
        nom: "Immeuble Concurrence",
        adresse: "1 rue du Verrou",
        codePostal: "69001",
        ville: "Lyon",
        typeHabitat: "collectif",
        regimeJuridique: "copropriete"
      });
      const appartements = moduleRef.get(AppartementsService);
      const appartement = await appartements.create({
        bienId: bien.id,
        numero: "1",
        type: "T2",
        nombrePiecesPrincipales: 2,
        modeChauffage: "individuel",
        modeEauChaude: "individuel",
        loyerReference: "700.00"
      });
      await appartements.update(appartement.id, { nombreChambres: 1, nombreSallesDeBain: 1, nombreWc: 1 });
      const locataire = await moduleRef.get(LocatairesService).create(contexte.utilisateurId, {
        nom: "Martin",
        prenom: "Claire"
      });
      const bail = await moduleRef.get(BauxService).create({
        appartementId: appartement.id,
        typeBail: "vide",
        dateDebut: "2026-08-01",
        loyerMensuel: "650.00",
        depotGarantie: "650.00",
        provisionsCharges: "30.00",
        jourEcheance: 5
      });
      await moduleRef.get(BailLocatairesService).create({ bailId: bail.id, locataireId: locataire.id, role: "titulaire" });
      const etatDesLieux = await moduleRef.get(EtatsDesLieuxService).create({ bailId: bail.id });
      return { etatDesLieuxId: etatDesLieux.id, locataireId: locataire.id };
    });
  }

  function declarer(etatDesLieuxId: string, locataireId: string, lieu = "Lyon") {
    return avecContexte(() =>
      entreePapier.declarer(
        etatDesLieuxId,
        { dateSignature: "2026-08-01", lieu, bailleurNom: "SCI Concurrence", locataireIds: [locataireId] },
        SCAN
      )
    );
  }

  function signerEntree(etatDesLieuxId: string, locataireId: string) {
    return avecContexte(() =>
      signature.signerEntree(etatDesLieuxId, {
        bailleur: { nomAffiche: "Bailleur", luEtApprouve: true, imagePng: PNG_1X1_BASE64 },
        locataires: [{ locataireId, luEtApprouve: true, imagePng: PNG_1X1_BASE64 }]
      })
    );
  }

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${NOM_BASE}"`);
    const urlBase = new URL(URL_SERVEUR.toString());
    urlBase.pathname = `/${NOM_BASE}`;
    db = createDbClient(urlBase.toString());
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
        LocatairesModule,
        BauxModule,
        BailLocatairesModule,
        DocumentsModule,
        EtatsDesLieuxModule,
        EtatsDesLieuxSignatureModule,
        EtatDesLieuxEntreePapierModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();
    requestContext = moduleRef.get(RequestContextService);
    entreePapier = moduleRef.get(EtatDesLieuxEntreePapierService);
    signature = moduleRef.get(EtatsDesLieuxSignatureService);

    const [organisation] = await db.insert(organisations).values({ type: "particulier", nom: "Concurrence" }).returning();
    const [utilisateur] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `concurrence-${randomUUID()}@example.com`,
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
    // Base propre à ce fichier, sur un serveur jetable : supprimée en
    // entier, connexions résiduelles (chaîne PDF d'arrière-plan) comprises.
    await admin.unsafe(`DROP DATABASE IF EXISTS "${NOM_BASE}" WITH (FORCE)`);
    await admin.end();
    await rm(storageDirTest, { recursive: true, force: true });
  });

  it("déclaration papier et signature numérique d'entrée simultanées : exactement une aboutit, à chaque essai", async () => {
    for (let essai = 0; essai < 5; essai++) {
      const { etatDesLieuxId, locataireId } = await creerDossier();

      const resultats = await Promise.allSettled([
        declarer(etatDesLieuxId, locataireId),
        signerEntree(etatDesLieuxId, locataireId)
      ]);

      const refus = resultats.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(refus, `essai ${essai}`).toHaveLength(1);
      expect(refus[0]!.reason, `essai ${essai}`).toBeInstanceOf(ConflictException);

      const declarations = await db
        .select()
        .from(etatDesLieuxEntreePapier)
        .where(eq(etatDesLieuxEntreePapier.etatDesLieuxId, etatDesLieuxId));
      const signaturesEntree = await db
        .select()
        .from(etatDesLieuxSignature)
        .where(and(eq(etatDesLieuxSignature.etatDesLieuxId, etatDesLieuxId), eq(etatDesLieuxSignature.phase, "entree")));
      // Jamais les deux, jamais aucune.
      expect([declarations.length, signaturesEntree.length > 0 ? 1 : 0].sort(), `essai ${essai}`).toEqual([0, 1]);
    }
  });

  it("deux déclarations simultanées : sérialisées par le verrou, une seule reste active", async () => {
    const { etatDesLieuxId, locataireId } = await creerDossier();

    const resultats = await Promise.allSettled([
      declarer(etatDesLieuxId, locataireId, "Lyon"),
      declarer(etatDesLieuxId, locataireId, "Villeurbanne")
    ]);

    const declarations = await db
      .select()
      .from(etatDesLieuxEntreePapier)
      .where(eq(etatDesLieuxEntreePapier.etatDesLieuxId, etatDesLieuxId));
    expect(declarations.filter((d) => d.archivedAt === null)).toHaveLength(1);
    // Chaque déclaration acceptée a laissé sa ligne (la seconde est une
    // correction de la première), aucune n'a été perdue.
    expect(declarations).toHaveLength(resultats.filter((r) => r.status === "fulfilled").length);
  });
});
