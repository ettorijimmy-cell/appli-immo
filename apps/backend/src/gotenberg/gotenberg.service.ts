import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resoudreConfigGotenberg, type GotenbergConfig } from "./gotenberg-config";
import { GotenbergConversionError, GotenbergIndisponibleError } from "./gotenberg.errors";

const MIME_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME_PDF = "application/pdf";
const SIGNATURE_PDF = "%PDF-";
const ENDPOINT_CONVERSION = "/forms/libreoffice/convert";

// Codes HTTP considérés transitoires côté Gotenberg (conteneur qui se
// réveille, proxy en amont) — GotenbergIndisponibleError (à relancer),
// jamais GotenbergConversionError (voir gotenberg.errors.ts). Tout autre
// code non-2xx (400, 401, 403, 404, 500 inclus) est traité comme un échec
// qui rejouerait identiquement — pas dans cet ensemble.
const CODES_HTTP_RELANCABLES: ReadonlySet<number> = new Set([502, 503, 504]);

// Client isolé, réutilisable (chantier PDF étape 4, 2026-10-27) — ne
// connaît rien du document généré ni de l'état des lieux : une seule
// responsabilité, convertir un .docx en .pdf via un Gotenberg privé
// (Réseau Privé Scaleway + Basic Auth, voir docs/backlog.md). Jamais
// appelé en dehors de ce module — le futur service de génération PDF
// l'injecte, jamais de second point d'appel HTTP vers Gotenberg ailleurs
// dans le code.
@Injectable()
export class GotenbergService {
  private readonly logger = new Logger(GotenbergService.name);
  private readonly config: GotenbergConfig | null;

  constructor(configService: ConfigService) {
    const resultat = resoudreConfigGotenberg((cle) => configService.get<string>(cle));
    switch (resultat.statut) {
      case "absente":
        this.config = null;
        this.logger.warn(
          "GOTENBERG_URL absente : la conversion PDF de l'état des lieux est indisponible (le backend démarre normalement)."
        );
        break;
      case "identifiants_partiels":
        this.config = null;
        this.logger.warn(
          "GOTENBERG_BASIC_AUTH_USERNAME et GOTENBERG_BASIC_AUTH_PASSWORD doivent être renseignées ensemble ou " +
            "absentes ensemble — un seul des deux est présent : configuration invalide, traitée comme non " +
            "configurée (conversion PDF indisponible, le backend démarre normalement)."
        );
        break;
      case "ok":
        this.config = resultat.config;
        break;
    }
  }

  // Permet à l'appelant de décider sans déclencher d'appel réseau (ex. le
  // futur bouton "Produire le PDF" côté desktop peut rester masqué plutôt
  // que d'échouer visiblement).
  estConfigure(): boolean {
    return this.config !== null;
  }

  async convertirDocxEnPdf(docx: Buffer, nomFichier: string): Promise<Buffer> {
    if (!this.config) {
      throw new GotenbergIndisponibleError();
    }

    const formulaire = new FormData();
    // new Uint8Array(docx) plutôt que docx directement : sous
    // exactOptionalPropertyTypes/lib DOM stricts, Buffer<ArrayBufferLike>
    // n'est pas assignable à BlobPart (qui exige Uint8Array<ArrayBuffer>) —
    // cette copie produit un Uint8Array adossé à un ArrayBuffer concret.
    formulaire.append("files", new Blob([new Uint8Array(docx)], { type: MIME_DOCX }), nomFichier);

    // Jamais stockée dans une variable nommée dans un message d'erreur
    // plus bas : seule cette requête fetch() la voit.
    const entetes: Record<string, string> = {};
    if (this.config.basicAuthUsername && this.config.basicAuthPassword) {
      const identifiants = Buffer.from(`${this.config.basicAuthUsername}:${this.config.basicAuthPassword}`).toString(
        "base64"
      );
      entetes["Authorization"] = `Basic ${identifiants}`;
    }

    let reponse: Response;
    try {
      reponse = await fetch(`${this.config.url}${ENDPOINT_CONVERSION}`, {
        method: "POST",
        headers: entetes,
        body: formulaire,
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (erreur) {
      // Réseau ou délai dépassé (AbortError/TimeoutError) : transitoire,
      // à relancer — (erreur as Error).message est le message générique
      // de fetch/AbortController, jamais un écho de la requête (en-têtes,
      // identifiants), donc sûr à inclure tel quel.
      throw new GotenbergIndisponibleError(
        `Appel à Gotenberg échoué (réseau ou délai dépassé après ${this.config.timeoutMs} ms) : ${(erreur as Error).message}`,
        { cause: erreur }
      );
    }

    if (!reponse.ok) {
      if (CODES_HTTP_RELANCABLES.has(reponse.status)) {
        throw new GotenbergIndisponibleError(`Gotenberg indisponible temporairement (HTTP ${reponse.status}).`);
      }
      // Corps de la RÉPONSE (texte renvoyé par Gotenberg), jamais la
      // requête — ne peut pas contenir nos identifiants.
      const corps = await reponse.text().catch(() => "");
      throw new GotenbergConversionError(`Gotenberg a répondu ${reponse.status} : ${corps.slice(0, 500)}`);
    }

    const contentType = reponse.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await reponse.arrayBuffer());
    const signature = buffer.subarray(0, SIGNATURE_PDF.length).toString("ascii");
    // Statut 2xx insuffisant pour faire confiance au corps : une page
    // d'erreur HTML renvoyée avec un 200 par un proxy en amont (ou par
    // Gotenberg lui-même dans un cas non prévu) serait sinon acceptée
    // comme un PDF valide. Les deux signaux (Content-Type ET signature
    // binaire) sont vérifiés, jamais un seul des deux.
    if (!contentType.includes(MIME_PDF) || signature !== SIGNATURE_PDF) {
      throw new GotenbergConversionError(
        `Réponse de Gotenberg invalide : Content-Type reçu '${contentType}', signature reçue '${signature}' ` +
          `(attendu '${MIME_PDF}' et '${SIGNATURE_PDF}').`
      );
    }

    return buffer;
  }
}
