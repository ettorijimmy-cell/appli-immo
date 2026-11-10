import { randomUUID } from "crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  bien as bienTable,
  createDbClient,
  DEFAULT_DEV_DATABASE_URL,
  indicesIrl,
  journalAudit,
  organisations,
  utilisateurs,
  type Database
} from "db";
import { and, eq } from "drizzle-orm";
import PizZip from "pizzip";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { DATABASE_CONNECTION, DatabaseModule } from "../database/database.module";
import { GarantsModule } from "../garants/garants.module";
import { GarantsService } from "../garants/garants.service";
import { LocatairesModule } from "../locataires/locataires.module";
import { LocatairesService } from "../locataires/locataires.service";
import { ScisModule } from "../scis/scis.module";
import { ScisService } from "../scis/scis.service";
import { createTransactionalTestHooks } from "../test-utils/transactional-test";
import { UsersModule } from "../users/users.module";
import { ActeCautionnementDocxModule } from "./acte-cautionnement-docx.module";
import { ActeCautionnementDocxService, MESSAGE_ACTE_RESERVE_CAUTION } from "./acte-cautionnement-docx.service";

// Modèle réel embarqué (assets/modele-acte-cautionnement.docx), jamais une
// fixture : aucune surcharge de ACTE_CAUTIONNEMENT_DOCX_TEMPLATE_PATH.
delete process.env["ACTE_CAUTIONNEMENT_DOCX_TEMPLATE_PATH"];

// Un paragraphe Word par ligne.
function texteDuDocx(buffer: Buffer): string {
  const xml = new PizZip(buffer).file("word/document.xml")!.asText();
  return xml
    .split("</w:p>")
    .map((p) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""))
    .filter((ligne) => ligne !== "")
    .join("\n");
}

const NBSP = "\u00a0";

interface OptionsDossier {
  bailleur?: "sci" | "personne_physique";
  estFamiliale?: boolean;
  typeBail?: "vide" | "meuble";
  colocation?: boolean;
  dateDebut?: string;
  loyerMensuel?: string;
  provisionsCharges?: string;
  trimestreReferenceRevision?: number | null;
  avecGerant?: boolean;
}

describe("Acte de cautionnement (intégration Postgres réelle, modèle embarqué)", () => {
  const rootDb = createDbClient(process.env["DATABASE_URL"] ?? DEFAULT_DEV_DATABASE_URL);
  const { begin, rollback } = createTransactionalTestHooks(rootDb);

  let moduleRef: TestingModule;
  let db: Database;
  let scisService: ScisService;
  let bienService: BienService;
  let appartementsService: AppartementsService;
  let locatairesService: LocatairesService;
  let garantsService: GarantsService;
  let bauxService: BauxService;
  let bailLocatairesService: BailLocatairesService;
  let acteService: ActeCautionnementDocxService;
  let requestContextService: RequestContextService;
  let userId: string;
  let organisationId: string;

  async function creerOrganisation(suffixe: string): Promise<{ organisationId: string; userId: string }> {
    const [organisation] = await db
      .insert(organisations)
      .values({ type: "particulier", nom: `Organisation Acte Cautionnement ${suffixe}` })
      .returning();
    const [user] = await db
      .insert(utilisateurs)
      .values({
        organisationId: organisation!.id,
        email: `acte-cautionnement-${suffixe}-${randomUUID()}@example.com`,
        nom: "Test",
        prenom: `Acte${suffixe}`,
        motDePasseHash: "peu-importe-pour-ce-test",
        statut: "actif"
      })
      .returning();
    return { organisationId: organisation!.id, userId: user!.id };
  }

  const dans = <T>(fn: () => Promise<T>, org = { userId, organisationId }): Promise<T> =>
    requestContextService.executerAvecContexte({ utilisateurId: org.userId, organisationId: org.organisationId }, fn);

  beforeEach(async () => {
    db = await begin();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        CommonModule,
        DatabaseModule,
        AuditModule,
        UsersModule,
        AuthModule,
        ScisModule,
        BienModule,
        AppartementsModule,
        LocatairesModule,
        GarantsModule,
        BauxModule,
        BailLocatairesModule,
        ActeCautionnementDocxModule
      ]
    })
      .overrideProvider(DATABASE_CONNECTION)
      .useValue(db)
      .compile();

    scisService = moduleRef.get(ScisService);
    bienService = moduleRef.get(BienService);
    appartementsService = moduleRef.get(AppartementsService);
    locatairesService = moduleRef.get(LocatairesService);
    garantsService = moduleRef.get(GarantsService);
    bauxService = moduleRef.get(BauxService);
    bailLocatairesService = moduleRef.get(BailLocatairesService);
    acteService = moduleRef.get(ActeCautionnementDocxService);
    requestContextService = moduleRef.get(RequestContextService);

    ({ organisationId, userId } = await creerOrganisation("A"));
    // Année hors plage réaliste : jamais en collision avec un vrai indice.
    await db.insert(indicesIrl).values({ annee: 9999, trimestre: 2, valeur: "148.37" });
  });

  afterEach(async () => {
    await moduleRef?.close();
    await rollback();
  });

  afterAll(async () => {
    await rootDb.$client.end();
  });

  // Dossier complet : bailleur, logement, bail, un locataire (deux en
  // colocation), une caution rattachée au dernier locataire.
  async function creerDossier(options: OptionsDossier = {}) {
    return dans(async () => {
      const bailleur = options.bailleur ?? "sci";
      let sciId: string | undefined;
      if (bailleur === "sci") {
        const sci = await scisService.create(userId, {
          nom: "SCI des Tilleuls",
          regimeFiscal: "IR",
          adresse: "3 place du Marché",
          codePostal: "19100",
          ville: "Brive"
        });
        await scisService.update(sci.id, {
          estFamiliale: options.estFamiliale ?? true,
          ...(options.avecGerant === false ? {} : { prenomGerant: "Hélène", nomGerant: "Marchal" })
        });
        sciId = sci.id;
      }
      const bien = await bienService.create(userId, {
        type: "immeuble",
        proprietaireType: bailleur,
        ...(sciId ? { sciId } : { nomProprietaire: "Jean Exemple" }),
        nom: "Immeuble des Tilleuls",
        adresse: "17 avenue du Test",
        codePostal: "19100",
        ville: "Brive",
        typeHabitat: "collectif",
        regimeJuridique: "copropriete"
      });
      await db.update(bienTable).set({ anneeConstruction: 1998 }).where(eq(bienTable.id, bien.id));
      const appartement = await appartementsService.create({
        bienId: bien.id,
        numero: "2",
        type: "T3",
        nombrePiecesPrincipales: 3,
        modeChauffage: "individuel",
        modeEauChaude: "individuel"
      });
      const bail = await bauxService.create({
        appartementId: appartement.id,
        typeBail: options.typeBail ?? "vide",
        dateDebut: options.dateDebut ?? "2026-07-01",
        dateSignature: "2026-06-20",
        loyerMensuel: options.loyerMensuel ?? "650.00",
        provisionsCharges: options.provisionsCharges ?? "30.00",
        jourEcheance: 5
      });
      if (options.trimestreReferenceRevision !== null) {
        await bauxService.update(bail.id, { trimestreReferenceRevision: options.trimestreReferenceRevision ?? 2 });
      }
      const titulaire = await locatairesService.create(userId, {
        nom: "Devos",
        prenom: "Ilan",
        adresse: "1 rue du Locataire",
        codePostal: "19100",
        ville: "Brive",
        dateNaissance: "1990-05-12"
      });
      await bailLocatairesService.create({ bailId: bail.id, locataireId: titulaire.id, role: "titulaire" });
      let garanti = titulaire;
      if (options.colocation) {
        garanti = await locatairesService.create(userId, { nom: "Roux", prenom: "Léa", dateNaissance: "1999-11-03" });
        await bailLocatairesService.create({ bailId: bail.id, locataireId: garanti.id, role: "colocataire" });
      }
      const caution = await garantsService.create({
        bailId: bail.id,
        typeGarantie: "personne_physique",
        nom: "Durand",
        prenom: "Claire",
        dateNaissance: "1965-03-20",
        lieuNaissance: "Lyon",
        nationalite: "Française",
        adresse: "8 rue de la Caution",
        codePostal: "69002",
        ville: "Lyon",
        ...(options.colocation ? { locataireId: garanti.id } : {})
      });
      return { bail, titulaire, garanti, caution };
    });
  }

  async function generer(garantId: string, dto = {}): Promise<string> {
    return texteDuDocx(await dans(() => acteService.genererActeCautionnementDocx(garantId, dto)));
  }

  async function champsManquants(garantId: string): Promise<string[]> {
    let erreur: unknown;
    try {
      await dans(() => acteService.genererActeCautionnementDocx(garantId, {}));
    } catch (e) {
      erreur = e;
    }
    expect(erreur).toBeInstanceOf(BadRequestException);
    return ((erreur as BadRequestException).getResponse() as { champsManquants: string[] }).champsManquants;
  }

  describe("matrice de rendu", () => {
    it("une caution, bailleur SCI familiale, bail vide 3 ans : parties, montants, révision, plafond, expiration, mention", async () => {
      const { caution } = await creerDossier();
      const texte = await generer(caution.id);

      // Aucune balise restante ; une seule mention à compléter : le lieu de
      // naissance du locataire, qui ne peut pas être saisi aujourd'hui.
      expect(texte).not.toMatch(/[{}]/);
      expect(texte.split("[À COMPLÉTER").length - 1).toBe(1);

      // Parties.
      expect(texte).toContain("Nom et prénom / Dénomination : SCI des Tilleuls");
      expect(texte).toContain(
        "représentée par Hélène Marchal, agissant en qualité de gérant, dûment habilité aux fins des présentes"
      );
      expect(texte).toContain("Adresse : 3 place du Marché, 19100 Brive");
      expect(texte).toContain("Nom et prénom : Ilan Devos");
      expect(texte).toContain("Date et lieu de naissance : 12/05/1990 à [À COMPLÉTER]");
      expect(texte).toContain("Nom et prénom : Claire Durand");
      expect(texte).toContain("Date et lieu de naissance : 20/03/1965 à Lyon");
      expect(texte).toContain("Adresse : 8 rue de la Caution, 69002 Lyon");
      expect(texte).not.toContain("Profession");

      // Logement et bail.
      expect(texte).toContain("Adresse du logement : 17 avenue du Test, 19100 Brive");
      expect(texte).toContain("Type de logement : Appartement (T3 - 2)");
      expect(texte).not.toContain("Étage");
      expect(texte).toContain("conclu entre le Bailleur et le Locataire le 20/06/2026, pour une prise d'effet au 01/07/2026.");
      expect(texte).toContain("Durée initiale du bail : 3 ans.");

      // Montants (chiffres et lettres) et révision.
      expect(texte).toContain(`650,00 € (six-cent-cinquante euros).`);
      expect(texte).toContain(`30,00 € (trente euros).`);
      expect(texte).toContain(`680,00 € (six-cent-quatre-vingts euros).`);
      expect(texte).toContain("chaque année le 01 juillet.");
      expect(texte).toContain("Trimestre de référence de l’indice : 2e trimestre.");
      // Virgule décimale dans l'acte (le bail garde le point).
      expect(texte).toContain("L’indice INSEE au jour des présentes est 148,37.");
      expect(texte).not.toContain("est révisable conformément");

      // Plafond : 36 × 680 €, dans l'article 5 et dans le modèle de mention.
      const plafond = `24${NBSP}480,00 € (vingt-quatre-mille-quatre-cent-quatre-vingts euros)`;
      expect(texte.split(plafond).length - 1).toBe(2);

      // Expiration : fin du bail initial + 2 renouvellements, dernier jour inclus.
      expect(texte).toContain("expirant le 30/06/2035.");

      // Art. 7, 8 et 9.
      expect(texte).not.toContain("Code de la consommation");
      // Art. 9 : virgule rétablie et espace insécable avant le » final.
      expect(texte).toContain(
        `qu'il s'agisse du contrat initial ou d'un contrat reconduit ou renouvelé, au cours duquel le bailleur reçoit notification de la résiliation.${NBSP}»`
      );

      // Art. 8 : consigne, modèle pré-rempli (renonciation comprise), puis
      // titre du cadre, dans cet ordre et avant l'article 9 ; plus de
      // dernière page.
      const article8 = texte.slice(texte.indexOf("ARTICLE 8 –"), texte.indexOf("ARTICLE 9 –"));
      expect(article8.split("\n")).toEqual([
        "ARTICLE 8 – MENTION OBLIGATOIRE DE LA CAUTION",
        "Cette mention doit être personnellement apposée par la Caution personne physique, conformément à l'article 2297 du Code civil.",
        "La Caution recopie elle-même, en entier, dans le cadre ci-dessous, le modèle de mention ci-dessus.",
        "Modèle à recopier :",
        `« En me portant caution solidaire de Ilan Devos, je m'engage à payer au Bailleur, en cas de défaillance du Locataire, les sommes dues au titre du contrat de location désigné dans le présent acte, dans la limite du montant maximal de ${plafond}, comprenant le principal et les accessoires.`,
        "Je reconnais que, compte tenu de la nature solidaire de mon engagement, je ne peux pas exiger du Bailleur qu'il poursuive d'abord le Locataire ni qu'il divise ses poursuites entre les différentes cautions éventuelles. »",
        "Mention à écrire en entier de la main de la Caution",
        ""
      ]);
      expect(texte).not.toContain("dernière page");
      expect(texte).not.toContain("Modèle de mention à recopier");

      // Pas de colocation ; lieu et date à compléter à la main ; le document
      // se termine par les signatures.
      expect(texte).not.toContain("article 8-1, VI");
      expect(texte).toContain("Fait à ………………………………………, le ……………………………………….");
      // Signatures de la caution : « Nom : » puis la ligne « Signature
      // précédée… », sans la ligne « Mention prévue à l'article 2297 ».
      expect(texte).not.toContain("personnellement apposée et validée");
      expect(texte.split("\n").slice(-3)).toEqual([
        "LA CAUTION",
        "Nom :",
        "Signature précédée de la mention « Lu et approuvé, bon pour caution solidaire »."
      ]);
    });

    it("colocation : le colocataire garanti est le locataire de l'acte et la section 8-1, VI le désigne", async () => {
      const { caution } = await creerDossier({ colocation: true });
      const texte = await generer(caution.id);
      expect(texte).toContain("Nom et prénom : Léa Roux");
      expect(texte).toContain(
        "Conformément à l'article 8-1, VI de la loi n° 89-462 du 6 juillet 1989, le colocataire dont l'extinction de la solidarité met fin à l'engagement de la Caution est : Léa Roux."
      );
      expect(texte).toContain("En me portant caution solidaire de Léa Roux,");
      // Adresse actuelle du colocataire non renseignée : à compléter.
      expect(texte).toContain("Adresse actuelle : [À COMPLÉTER]");
    });

    it("bailleur personne physique : nom du propriétaire, adresse à compléter, aucun représentant", async () => {
      const { caution } = await creerDossier({ bailleur: "personne_physique" });
      const texte = await generer(caution.id);
      expect(texte).toContain("Nom et prénom / Dénomination : Jean Exemple");
      expect(texte).toContain("Adresse : [À COMPLÉTER]");
      expect(texte).not.toContain("représentée par");
      expect(texte).toContain("Durée initiale du bail : 3 ans.");
    });

    it("bailleur SCI sans gérant renseigné : mention à compléter, jamais de blocage", async () => {
      const { caution } = await creerDossier({ avecGerant: false });
      expect(await generer(caution.id)).toContain("représentée par [À COMPLÉTER : gérant de la SCI], agissant en qualité de gérant");
    });

    it("SCI non familiale, bail vide 6 ans (locataire étudiant non boursier) : expiration à 18 ans", async () => {
      const { caution, titulaire } = await creerDossier({ estFamiliale: false });
      await dans(() => locatairesService.update(titulaire.id, { statutEtudes: "etudiant_non_boursier" }));
      const texte = await generer(caution.id);
      expect(texte).toContain("Durée initiale du bail : 6 ans.");
      expect(texte).toContain("expirant le 30/06/2044.");
    });

    it("bail meublé 1 an : expiration à 3 ans ; meublé étudiant 9 mois : fin du bail initial", async () => {
      const { caution } = await creerDossier({ typeBail: "meuble" });
      const standard = await generer(caution.id);
      expect(standard).toContain("Durée initiale du bail : 1 an.");
      expect(standard).toContain("expirant le 30/06/2029.");

      const etudiant = await generer(caution.id, { regimeDureeMeuble: "etudiant" });
      expect(etudiant).toContain("Durée initiale du bail : 9 mois.");
      expect(etudiant).toContain("expirant le 31/03/2027.");
    });

    it("plafond en lettres avec centimes : 36 × (612,34 + 45,67)", async () => {
      const { caution } = await creerDossier({ loyerMensuel: "612.34", provisionsCharges: "45.67" });
      const texte = await generer(caution.id);
      expect(texte).toContain(
        `23${NBSP}688,36 € (vingt-trois-mille-six-cent-quatre-vingt-huit euros et trente-six centimes)`
      );
      expect(texte).toContain("658,01 € (six-cent-cinquante-huit euros et un centime).");
    });
  });

  describe("refus et champs manquants", () => {
    it("garantie Visale : 400, acte réservé à une caution personne physique", async () => {
      const { bail } = await creerDossier();
      const visale = await dans(() =>
        garantsService.create({ bailId: bail.id, typeGarantie: "garantie_visale", numeroContratVisale: "V0001" })
      );
      await expect(dans(() => acteService.genererActeCautionnementDocx(visale.id, {}))).rejects.toThrow(
        new BadRequestException(MESSAGE_ACTE_RESERVE_CAUTION)
      );
    });

    it("garant retiré du bail ou inexistant : 404", async () => {
      const { caution } = await creerDossier();
      await dans(() => garantsService.archive(caution.id));
      await expect(dans(() => acteService.genererActeCautionnementDocx(caution.id, {}))).rejects.toThrow(
        new NotFoundException("Garant introuvable")
      );
      await expect(dans(() => acteService.genererActeCautionnementDocx(randomUUID(), {}))).rejects.toThrow(
        new NotFoundException("Garant introuvable")
      );
    });

    it("liste complète des manques : trimestre de référence et lieu de naissance de la caution", async () => {
      const { caution } = await creerDossier({ trimestreReferenceRevision: null });
      await dans(() => garantsService.update(caution.id, { lieuNaissance: null }));
      expect(await champsManquants(caution.id)).toEqual([
        "Caution — lieu de naissance",
        "Trimestre IRL de référence du bail"
      ]);
    });

    it("règles d'acceptation (même contexte que le bail) : assurance loyers impayés bloque la caution", async () => {
      const { caution, bail } = await creerDossier();
      await dans(() => bauxService.update(bail.id, { assuranceLoyersImpayes: true }));
      const manquants = await champsManquants(caution.id);
      expect(manquants).toHaveLength(1);
      expect(manquants[0]).toMatch(/^Garant — caution personne physique impossible : le bail est couvert par une assurance loyers impayés/);
    });

    it("colocation sans « Caution de » : bloqué", async () => {
      const { caution } = await creerDossier({ colocation: true });
      await dans(() => garantsService.update(caution.id, { locataireId: null }));
      expect(await champsManquants(caution.id)).toEqual([
        "Garant — colocation : préciser le locataire garanti (« Caution de »)"
      ]);
    });
  });

  describe("organisation et traçabilité", () => {
    it("garant d'une autre organisation : 404, même message qu'un garant inexistant", async () => {
      const { caution } = await creerDossier();
      const autre = await creerOrganisation("B");
      await expect(dans(() => acteService.genererActeCautionnementDocx(caution.id, {}), autre)).rejects.toThrow(
        new NotFoundException("Garant introuvable")
      );
    });

    it("chaque génération est tracée dans le journal d'audit", async () => {
      const { caution } = await creerDossier();
      await generer(caution.id);
      const lignes = await db
        .select()
        .from(journalAudit)
        .where(and(eq(journalAudit.entiteType, "acte_cautionnement_genere"), eq(journalAudit.entiteId, caution.id)));
      expect(lignes).toHaveLength(1);
      expect(lignes[0]).toMatchObject({ action: "acces", utilisateurId: userId });
    });
  });
});
