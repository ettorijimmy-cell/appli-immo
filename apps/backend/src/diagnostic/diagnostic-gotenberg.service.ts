import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import PizZip from "pizzip";
import { resoudreConfigGotenberg, type GotenbergConfig } from "../gotenberg/gotenberg-config";
import { GotenbergConversionError, GotenbergIndisponibleError } from "../gotenberg/gotenberg.errors";
import { GotenbergService } from "../gotenberg/gotenberg.service";

const ENDPOINT_SANTE = "/health";
const ENDPOINT_CONVERSION = "/forms/libreoffice/convert";
const TEXTE_DOCUMENT_TEST = "Test Briky";
const NOM_FICHIER_TEST = "diagnostic-gotenberg-test.docx";

export type StatutConfigureDiagnostic = "absente" | "identifiants_partiels" | "ok";

export interface ResultatSanteDiagnostic {
  codeHttp: number | null;
  dureeMs: number;
}

export interface ResultatConversionDiagnostic {
  pdfValide: boolean;
  dureeMs: number;
  erreur: "indisponible" | "conversion" | null;
}

export interface DiagnosticGotenberg {
  configure: StatutConfigureDiagnostic;
  // null si configure !== "ok" : aucun appel réseau n'est possible sans
  // GOTENBERG_URL, jamais une valeur par défaut qui laisserait croire à
  // une mesure réelle.
  sante: ResultatSanteDiagnostic | null;
  authExigee: boolean | null;
  conversion: ResultatConversionDiagnostic | null;
}

// Diagnostic en lecture, protégé par le JwtAuthGuard global habituel (voir
// DiagnosticController) — aucun secret ni URL complète dans la réponse,
// rien n'est stocké (voir docs/backlog.md, "Déploiement de l'étape 4").
// La conversion passe exclusivement par GotenbergService.convertirDocxEnPdf
// (voir son commentaire : jamais de second point d'appel HTTP de
// conversion ailleurs dans le code) ; sante/authExigee sont des sondes
// propres à ce diagnostic (health check, appel volontairement sans
// identifiants) que GotenbergService n'a pas à exposer pour son usage
// normal.
@Injectable()
export class DiagnosticGotenbergService {
  constructor(
    private readonly configService: ConfigService,
    private readonly gotenbergService: GotenbergService
  ) {}

  async executer(): Promise<DiagnosticGotenberg> {
    const resultat = resoudreConfigGotenberg((cle) => this.configService.get<string>(cle));
    if (resultat.statut !== "ok") {
      return { configure: resultat.statut, sante: null, authExigee: null, conversion: null };
    }

    const { config } = resultat;
    const [sante, authExigee, conversion] = await Promise.all([
      this.verifierSante(config),
      this.verifierAuthExigee(config),
      this.verifierConversion()
    ]);

    return { configure: "ok", sante, authExigee, conversion };
  }

  private enteteAuth(config: GotenbergConfig): Record<string, string> {
    if (!config.basicAuthUsername || !config.basicAuthPassword) {
      return {};
    }
    const identifiants = Buffer.from(`${config.basicAuthUsername}:${config.basicAuthPassword}`).toString("base64");
    return { Authorization: `Basic ${identifiants}` };
  }

  private async verifierSante(config: GotenbergConfig): Promise<ResultatSanteDiagnostic> {
    const debut = Date.now();
    try {
      const reponse = await fetch(`${config.url}${ENDPOINT_SANTE}`, {
        headers: this.enteteAuth(config),
        signal: AbortSignal.timeout(config.timeoutMs)
      });
      return { codeHttp: reponse.status, dureeMs: Date.now() - debut };
    } catch {
      return { codeHttp: null, dureeMs: Date.now() - debut };
    }
  }

  // Volontairement SANS l'en-tête Authorization, même si des identifiants
  // sont configurés : seul moyen de vérifier que Gotenberg les exige
  // réellement, plutôt que de supposer que API_ENABLE_BASIC_AUTH a bien
  // été activé côté conteneur.
  private async verifierAuthExigee(config: GotenbergConfig): Promise<boolean> {
    try {
      const reponse = await fetch(`${config.url}${ENDPOINT_CONVERSION}`, {
        method: "POST",
        signal: AbortSignal.timeout(config.timeoutMs)
      });
      return reponse.status === 401;
    } catch {
      return false;
    }
  }

  private async verifierConversion(): Promise<ResultatConversionDiagnostic> {
    const debut = Date.now();
    try {
      await this.gotenbergService.convertirDocxEnPdf(creerDocxTest(), NOM_FICHIER_TEST);
      return { pdfValide: true, dureeMs: Date.now() - debut, erreur: null };
    } catch (erreur) {
      const dureeMs = Date.now() - debut;
      if (erreur instanceof GotenbergIndisponibleError) {
        return { pdfValide: false, dureeMs, erreur: "indisponible" };
      }
      if (erreur instanceof GotenbergConversionError) {
        return { pdfValide: false, dureeMs, erreur: "conversion" };
      }
      throw erreur;
    }
  }
}

// .docx minimal construit à la volée (PizZip, déjà une dépendance du
// backend — voir etat-des-lieux-document-docx) : contenu fixe "Test
// Briky", jamais de donnée réelle, ce diagnostic ne lit jamais la base.
// Structure OOXML volontairement réduite au strict nécessaire pour
// LibreOffice (pas de word/_rels/document.xml.rels — aucune ressource
// externe référencée).
function creerDocxTest(): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>"
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>"
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${TEXTE_DOCUMENT_TEST}</w:t></w:r></w:p></w:body>` +
      "</w:document>"
  );
  return zip.generate({ type: "nodebuffer" });
}
