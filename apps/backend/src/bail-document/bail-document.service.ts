import { Inject, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import {
  calculerLoyerPrecedentLocataire,
  calculerTrancheConstruction,
  regimesDureeApplicables,
  type ChoixDureeBail
} from "core";
import {
  appartements,
  bailLocataires,
  baux,
  diagnostics,
  documents,
  immeubles,
  locataires,
  scis,
  type Database
} from "db";
import { and, desc, eq, isNull, lt, ne } from "drizzle-orm";
import pdfMake from "pdfmake";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { DATABASE_CONNECTION } from "../database/database.module";
import type { GenererDocumentBailDto } from "./dto/generer-document-bail.dto";
import { construireSectionI } from "./sections/section-i-parties";
import { construireSectionII } from "./sections/section-ii-objet";
import { construireSectionIII } from "./sections/section-iii-duree";
import { construireSectionIV } from "./sections/section-iv-conditions-financieres";
import { construireSectionV } from "./sections/section-v-travaux";
import { construireSectionVI } from "./sections/section-vi-garanties";
import { construireSectionVII } from "./sections/section-vii-solidarite";
import { construireSectionVIII } from "./sections/section-viii-clause-resolutoire";
import { construireSectionIX } from "./sections/section-ix-honoraires";
import { construireSectionX } from "./sections/section-x-conditions-particulieres";
import { construireSectionXI } from "./sections/section-xi-annexes";
import type { DiagnosticAnnexe } from "./types";

// Police standard PDF (Helvetica, les 14 polices de base) — aucun fichier
// de police à embarquer, disponible nativement dans tout lecteur PDF.
const POLICES = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique"
  }
};

@Injectable()
export class BailDocumentService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: Database) {}

  async genererDocumentBail(bailId: string, dto: GenererDocumentBailDto): Promise<Buffer> {
    const [bail] = await this.db.select().from(baux).where(eq(baux.id, bailId)).limit(1);
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }

    const choixDuree = this.resoudreChoixDuree(bail.typeBail, dto.regimeDuree);

    const [appartement] = await this.db
      .select()
      .from(appartements)
      .where(eq(appartements.id, bail.appartementId))
      .limit(1);
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }

    const [immeuble] = await this.db
      .select()
      .from(immeubles)
      .where(eq(immeubles.id, appartement.immeubleId))
      .limit(1);
    if (!immeuble) {
      throw new NotFoundException("Immeuble introuvable");
    }

    const [sci] = await this.db.select().from(scis).where(eq(scis.id, immeuble.sciId)).limit(1);
    if (!sci) {
      throw new NotFoundException("SCI introuvable");
    }

    const liensLocataires = await this.db
      .select()
      .from(bailLocataires)
      .where(and(eq(bailLocataires.bailId, bailId), isNull(bailLocataires.archivedAt)));
    const locatairesDuBail = await Promise.all(
      liensLocataires.map(async (lien) => {
        const [locataire] = await this.db
          .select()
          .from(locataires)
          .where(eq(locataires.id, lien.locataireId))
          .limit(1);
        return locataire;
      })
    );

    // Diagnostics : rattachés soit à l'appartement (DPE/CREP, toujours),
    // soit à l'immeuble (ERP, souvent tout le bâtiment) — voir
    // docs/data-dictionary.md, section "Édition d'un bail".
    const documentsAppartement = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.entiteType, "appartement"), eq(documents.entiteId, appartement.id)));
    const documentsImmeuble = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.entiteType, "immeuble"), eq(documents.entiteId, immeuble.id)));
    const tousLesDocumentsPertinents = [...documentsAppartement, ...documentsImmeuble];

    const diagnosticsTrouves = await Promise.all(
      tousLesDocumentsPertinents.map(async (document) => {
        const [ligne] = await this.db
          .select()
          .from(diagnostics)
          .where(eq(diagnostics.documentId, document.id))
          .limit(1);
        return ligne ? { document, diagnostic: ligne } : null;
      })
    );

    const diagnosticParType = new Map(
      diagnosticsTrouves
        .filter((valeur): valeur is NonNullable<typeof valeur> => valeur !== null)
        .map(({ document, diagnostic }) => [diagnostic.type, { document, diagnostic }])
    );

    // Attestation d'assurance et état des lieux d'entrée : simple présence
    // d'un document de la bonne catégorie, rattaché au bail.
    const documentsDuBail = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.entiteType, "bail"), eq(documents.entiteId, bailId)));
    const attestationAssurancePresente = documentsDuBail.some((d) => d.categorie === "assurance");
    const etatDesLieuxEntreePresent = documentsDuBail.some((d) => d.categorie === "etat_des_lieux");

    // Loyer du précédent locataire (section IV) : bail résilié le plus
    // récent sur le même appartement, hors le bail courant lui-même.
    const [bailPrecedent] = await this.db
      .select()
      .from(baux)
      .where(
        and(
          eq(baux.appartementId, appartement.id),
          eq(baux.statut, "resilie"),
          ne(baux.id, bailId),
          lt(baux.dateDebut, bail.dateDebut)
        )
      )
      .orderBy(desc(baux.dateFin))
      .limit(1);

    const loyerPrecedentLocataire = calculerLoyerPrecedentLocataire(
      bailPrecedent ? { loyerMensuel: bailPrecedent.loyerMensuel, dateFin: bailPrecedent.dateFin } : null,
      bail.dateDebut
    );

    const dpe = diagnosticParType.get("dpe");
    const trancheConstruction = immeuble.anneeConstruction
      ? calculerTrancheConstruction(immeuble.anneeConstruction)
      : null;

    // Section I
    const sectionI = construireSectionI({
      bailleur: {
        nom: sci.nom,
        adresse: immeuble.adresse,
        codePostal: sci.codePostal,
        ville: sci.ville,
        nomGerant: sci.nomGerant,
        prenomGerant: sci.prenomGerant
      },
      locataires: locatairesDuBail
        .filter((l): l is NonNullable<typeof l> => l !== undefined)
        .map((l) => ({ nom: l.nom, prenom: l.prenom, email: l.email }))
    });

    // Section II
    const sectionII = construireSectionII({
      typeBail: bail.typeBail,
      logement: {
        adresseImmeuble: immeuble.adresse,
        codePostalImmeuble: immeuble.codePostal,
        villeImmeuble: immeuble.ville,
        numeroLot: appartement.numero,
        identifiantFiscal: appartement.identifiantFiscal,
        typeHabitat: immeuble.typeHabitat,
        regimeJuridique: immeuble.regimeJuridique,
        trancheConstruction,
        surface: appartement.surface,
        nombrePiecesPrincipales: appartement.nombrePiecesPrincipales,
        modeChauffage: appartement.modeChauffage,
        modeEauChaude: appartement.modeEauChaude,
        classeDpe: dpe?.diagnostic.classeDpe ?? null,
        depensesTheoriquesChauffage: dpe?.diagnostic.depensesTheoriquesChauffage ?? null
      },
      dateReference: bail.dateDebut,
      servitudeResidencePrincipale: dto.servitudeResidencePrincipale ?? false
    });

    // Section III
    const sectionIII = construireSectionIII({ dateDebut: bail.dateDebut, choixDuree });

    // Section IV
    const sectionIV = construireSectionIV({
      loyerMensuel: bail.loyerMensuel,
      provisionsCharges: bail.provisionsCharges,
      loyerPrecedentLocataire,
      depensesTheoriquesChauffage: dpe?.diagnostic.depensesTheoriquesChauffage ?? null
    });

    // Section V
    const sectionV = construireSectionV({ travauxRealises: bail.travauxRealises });

    // Section VI
    const sectionVI = construireSectionVI({ depotGarantie: bail.depotGarantie });

    // Section VII
    const sectionVII = construireSectionVII({ nombreLocataires: liensLocataires.length });

    // Section VIII — `dateDebut` comme approximation de la "date de
    // conclusion" du contrat (décret n° 2026-596, article 3) : le schéma
    // actuel n'a pas de date de signature distincte (docs/data-
    // dictionary.md, section "Édition d'un bail").
    const sectionVIII = construireSectionVIII({
      dateReference: bail.dateDebut,
      servitudeResidencePrincipale: dto.servitudeResidencePrincipale ?? false
    });

    // Section IX
    const sectionIX = construireSectionIX({
      honorairesBailleur: bail.honorairesBailleur,
      honorairesLocataire: bail.honorairesLocataire
    });

    // Section X
    const sectionX = construireSectionX({ conditionsParticulieres: dto.conditionsParticulieres ?? null });

    // Section XI
    // NOTE : l'état des installations élec/gaz n'a, à ce jour, aucune
    // catégorie `documents` dédiée qui le distingue sans ambiguïté d'un
    // autre diagnostic générique — affiché "absent" par défaut tant que ce
    // point n'est pas éclairci (voir le rapport de génération de ce
    // premier PDF).
    const diagnosticsAnnexe: DiagnosticAnnexe[] = (["dpe", "crep_plomb", "erp"] as const).map((type) => {
      const trouve = diagnosticParType.get(type);
      return {
        categorie: type,
        present: trouve !== undefined,
        dateExpiration: trouve?.document.dateExpiration ?? null
      };
    });
    diagnosticsAnnexe.push({ categorie: "elec_gaz", present: false, dateExpiration: null });

    const sectionXI = construireSectionXI({
      typeBail: bail.typeBail,
      diagnostics: diagnosticsAnnexe,
      attestationAssurancePresente,
      etatDesLieuxEntreePresent
    });

    const contenu: Content[] = [
      sectionI,
      sectionII,
      sectionIII,
      sectionIV,
      sectionV,
      sectionVI,
      sectionVII,
      sectionVIII,
      sectionIX,
      sectionX,
      sectionXI
    ];

    const docDefinition: TDocumentDefinitions = {
      content: contenu,
      styles: {
        titreSection: { fontSize: 13, bold: true, margin: [0, 10, 0, 4] },
        titreSousSection: { fontSize: 11, bold: true }
      },
      defaultStyle: { font: "Helvetica", fontSize: 10 }
    };

    pdfMake.setFonts(POLICES);
    return pdfMake.createPdf(docDefinition).getBuffer();
  }

  private resoudreChoixDuree(
    typeBail: "vide" | "meuble",
    regimeDemande: string | undefined
  ): ChoixDureeBail {
    const { regimes, parDefaut } = regimesDureeApplicables(typeBail);
    const regime = regimeDemande ?? parDefaut;

    if (!regime || !regimes.includes(regime)) {
      throw new BadRequestException(
        `Choix de durée requis pour un bail ${typeBail} : régime attendu parmi [${regimes.join(", ")}].`
      );
    }

    return typeBail === "vide"
      ? { typeBail: "vide", regime: regime as "sci_familiale" | "sci_non_familiale" }
      : { typeBail: "meuble", regime: regime as "standard" | "etudiant" };
  }
}
