import { readFileSync } from "fs";
import path from "path";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  centimesVersMontant,
  decomposerDate,
  formaterListeNoms,
  libelleMoisDepuisDate,
  montantEnCentimes,
  validerCompletudeGenerationQuittance,
  type DonneesCompletudeQuittance
} from "core";
import { appartements, bailLocataires, baux, bien, locataires, paiements, versements, type Database } from "db";
import Docxtemplater from "docxtemplater";
import { and, desc, eq, isNull } from "drizzle-orm";
import PizZip from "pizzip";
import { AuditService } from "../audit/audit.service";
import { BienService } from "../bien/bien.service";
import { RequestContextService } from "../common/request-context";
import { DATABASE_CONNECTION } from "../database/database.module";

// Vide jamais utilisé ici, contrairement à bail-document-docx : chaque
// balise de la quittance est bloquante (validerCompletudeGenerationQuittance)
// — aucun champ optionnel dans ce document, jamais un "Néant" ou un blanc
// silencieux sur un document à valeur probante (Module Tâches, Étape 4,
// docs/backlog.md).
@Injectable()
export class QuittanceDocumentDocxService {
  private readonly templatePath: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
    private readonly bienService: BienService,
    config: ConfigService
  ) {
    this.templatePath =
      config.get<string>("QUITTANCE_DOCUMENT_DOCX_TEMPLATE_PATH") ??
      path.join(process.cwd(), "..", "..", "tmp", "Modèle quittance.docx");
  }

  async genererDocumentQuittanceDocx(paiementId: string): Promise<Buffer> {
    const [paiement] = await this.db.select().from(paiements).where(eq(paiements.id, paiementId)).limit(1);
    if (!paiement) {
      throw new NotFoundException("Paiement introuvable");
    }
    // Une quittance atteste un paiement REÇU, jamais une échéance à venir
    // (docs/backlog.md, Module Tâches, Étape 4) — même garde que
    // TachesJobService.genererTachesQuittanceMensuelle, revérifiée ici
    // (l'appelant pourrait être direct, pas nécessairement passé par la
    // tâche).
    if (paiement.type !== "loyer" || paiement.statut !== "paye") {
      throw new BadRequestException(
        "La génération de quittance n'est disponible que pour un paiement de loyer réglé (statut 'paye')."
      );
    }

    const [bail] = await this.db.select().from(baux).where(eq(baux.id, paiement.bailId)).limit(1);
    if (!bail) {
      throw new NotFoundException("Bail introuvable");
    }
    const [appartement] = await this.db
      .select()
      .from(appartements)
      .where(eq(appartements.id, bail.appartementId))
      .limit(1);
    if (!appartement) {
      throw new NotFoundException("Appartement introuvable");
    }
    const [bienRow] = await this.db.select().from(bien).where(eq(bien.id, appartement.bienId)).limit(1);
    if (!bienRow) {
      throw new NotFoundException("Bien introuvable");
    }

    // Contrôle d'appartenance (Commit B2, chantier scoping multi-organisation,
    // 2026-09-18) : même message que le paiement inexistant ci-dessus —
    // jamais de distinction observable entre "paiement introuvable" et
    // "paiement d'une autre organisation". Placé avant toute donnée
    // supplémentaire et avant le rendu du docx.
    const organisationId = this.requestContext.getOrganisationId();
    if (organisationId && bienRow.organisationId !== organisationId) {
      throw new NotFoundException("Paiement introuvable");
    }

    // Bailleur : même service partagé que bail-document-docx (corrige le
    // même bug SCI-only à la source, docs/backlog.md, 2026-08-31).
    const nomBailleur = await this.bienService.resoudreNomBailleur(bienRow.id);

    const liensLocataires = await this.db
      .select()
      .from(bailLocataires)
      .where(and(eq(bailLocataires.bailId, bail.id), isNull(bailLocataires.archivedAt)));
    const locatairesDuBail = (
      await Promise.all(
        liensLocataires.map(async (lien) => {
          const [locataire] = await this.db.select().from(locataires).where(eq(locataires.id, lien.locataireId)).limit(1);
          return locataire;
        })
      )
    ).filter((l): l is NonNullable<typeof l> => l !== undefined);
    const nomLocataire =
      locatairesDuBail.length > 0 ? formaterListeNoms(locatairesDuBail.map((l) => `${l.prenom} ${l.nom}`)) : null;

    const libelleBien = `${bienRow.nom ?? bienRow.adresse} — n°${appartement.numero}`;
    const dateReglement = await this.resoudreDateReglement(paiement.id);
    const { annee } = decomposerDate(paiement.dateEcheance);
    const periode = `${libelleMoisDepuisDate(paiement.dateEcheance)} ${annee}`;

    // Étape obligatoire AVANT toute génération : liste complète des champs
    // manquants en un seul appel, même discipline que
    // bail-document-docx.service.ts (packages/core,
    // validerCompletudeGenerationQuittance). loyerHorsCharges/charges
    // viennent des colonnes FIGÉES de paiements (jamais recalculées).
    const donneesCompletude: DonneesCompletudeQuittance = {
      nomBailleur,
      nomLocataire,
      libelleBien,
      periode,
      loyerHorsCharges: paiement.loyerHorsCharges,
      charges: paiement.charges,
      dateReglement,
      villeEmission: bienRow.ville
    };
    const champsManquants = validerCompletudeGenerationQuittance(donneesCompletude);
    if (champsManquants.length > 0) {
      throw new BadRequestException({
        message: "Génération impossible : champs obligatoires manquants",
        champsManquants
      });
    }

    // Non-null : validerCompletudeGenerationQuittance vient de garantir
    // qu'aucun de ces champs n'est null (throw sinon, ci-dessus).
    const montantTotal = centimesVersMontant(
      montantEnCentimes(donneesCompletude.loyerHorsCharges!) + montantEnCentimes(donneesCompletude.charges!)
    );

    const donneesBalises: Record<string, string> = {
      "Nom du bailleur": nomBailleur!,
      "Nom du locataire": nomLocataire!,
      "Adresse du logement": libelleBien,
      Periode: periode,
      "Montant loyer": donneesCompletude.loyerHorsCharges!,
      "Montant charges": donneesCompletude.charges!,
      "Montant total": montantTotal,
      "Date de paiement": dateReglement!,
      "Ville emission": donneesCompletude.villeEmission!,
      "Date d'emission": new Date().toISOString().slice(0, 10)
    };

    const buffer = this.rendreDocument(donneesBalises);

    const utilisateurId = this.requestContext.getUtilisateurId();
    if (utilisateurId) {
      await this.auditService.logAccesDonneeSensible({
        entiteType: "quittance_document_genere",
        entiteId: paiementId,
        utilisateurId
      });
    }

    return buffer;
  }

  // Aucune colonne de date de règlement sur paiements — la seule source est
  // versements.dateVersement. Le dernier versement actif fait foi (même
  // précédent que bail-document-docx.service.ts pour "date de versement
  // loyer précédent locataire") : quand un paiement a été réglé en
  // plusieurs fois, c'est le dernier versement qui fait effectivement
  // passer statut à 'paye'.
  private async resoudreDateReglement(paiementId: string): Promise<string | null> {
    const [dernierVersement] = await this.db
      .select({ dateVersement: versements.dateVersement })
      .from(versements)
      .where(and(eq(versements.paiementId, paiementId), isNull(versements.archivedAt)))
      .orderBy(desc(versements.dateVersement))
      .limit(1);
    return dernierVersement?.dateVersement ?? null;
  }

  private rendreDocument(donneesBalises: Record<string, string>): Buffer {
    const contenu = readFileSync(this.templatePath, "binary");
    const zip = new PizZip(contenu);
    const document = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    document.render(donneesBalises);
    return document.getZip().generate({ type: "nodebuffer" }) as Buffer;
  }
}
