import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { NodemailerError } from "nodemailer";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import { RequestContextService } from "../common/request-context";
import { BoiteMailDedieeService } from "../messagerie/boite-mail-dediee.service";
import { SMTP_HOST } from "../messagerie/smtp-envoi.service";

// Plus courts que les défauts de nodemailer (jusqu'à 2 minutes pour la
// connexion, 10 pour le socket) : un port bloqué en sortie se manifeste
// justement par une attente sans réponse, ce diagnostic doit la conclure
// rapidement plutôt que de rester suspendu.
const DELAI_CONNEXION_MS = 10_000;
const DELAI_ACCUEIL_MS = 10_000;
const DELAI_SOCKET_MS = 15_000;
const DELAI_DNS_MS = 10_000;
// Filet final si aucun des délais ci-dessus ne se déclenche : une sonde se
// termine toujours, quel que soit l'état de la connexion.
const PLAFOND_SONDE_MS = 45_000;

const SONDES_SMTP = [
  { port: 465, modeTls: "tls_implicite" },
  { port: 587, modeTls: "starttls" }
] as const;

export type StatutBoiteDiagnostic = "configuree" | "non_configuree" | "illisible";
export type ModeTlsDiagnostic = (typeof SONDES_SMTP)[number]["modeTls"];
export type ResultatEtapeSmtp = "ok" | "echec" | "non_teste" | "non_applicable";

export interface ErreurSondeSmtp {
  // Code nodemailer (ETIMEDOUT, ECONNECTION, ETLS, EAUTH...) et code de
  // réponse SMTP numérique : jamais err.message ni err.response, qui
  // peuvent reprendre le texte du serveur et l'adresse de la boîte.
  code: string;
  codeSmtp: number | null;
}

export interface ResultatPortSmtp {
  port: number;
  modeTls: ModeTlsDiagnostic;
  connexion: ResultatEtapeSmtp;
  ehlo: ResultatEtapeSmtp;
  starttls: ResultatEtapeSmtp;
  authentification: ResultatEtapeSmtp;
  // Valeur de l'extension SIZE, lue sur la session chiffrée. null si le
  // serveur ne l'annonce pas ou si l'EHLO n'a pas abouti.
  tailleMaxOctets: number | null;
  dureeMs: number;
  erreur: ErreurSondeSmtp | null;
}

export interface DiagnosticSmtp {
  boite: StatutBoiteDiagnostic;
  ports: ResultatPortSmtp[];
}

type Identifiants = { email: string; motDePasseApp: string };
type SondeSmtp = (typeof SONDES_SMTP)[number];
type Etapes = Pick<ResultatPortSmtp, "connexion" | "ehlo" | "starttls" | "authentification" | "tailleMaxOctets">;

export function lireTailleMaxEhlo(reponseEhlo: string | false): number | null {
  if (!reponseEhlo) {
    return null;
  }
  const correspondance = /^\d{3}[ -]SIZE[ \t]+(\d+)\s*$/im.exec(reponseEhlo);
  return correspondance?.[1] ? Number(correspondance[1]) : null;
}

function normaliserErreur(erreur: NodemailerError | undefined): ErreurSondeSmtp {
  const code = erreur?.code && /^E[A-Z0-9_]+$/.test(erreur.code) ? erreur.code : "INCONNU";
  return { code, codeSmtp: typeof erreur?.responseCode === "number" ? erreur.responseCode : null };
}

// Sonde chaque port sans jamais envoyer de mail : connexion, EHLO, STARTTLS
// le cas échéant, authentification, lecture de SIZE, puis fermeture. Le
// réseau est testé même sans boîte exploitable (authentification
// "non_teste") : un blocage de port se voit sans identifiants. Protégée par
// le JwtAuthGuard global, comme DiagnosticGotenbergService ; aucune adresse
// ni aucun secret dans la réponse, rien n'est stocké. L'accès au mot de
// passe est journalisé dans journal_audit par obtenirIdentifiants().
@Injectable()
export class DiagnosticSmtpService {
  private readonly logger = new Logger(DiagnosticSmtpService.name);

  constructor(
    @Inject(BoiteMailDedieeService) private readonly boiteMailDedieeService: BoiteMailDedieeService,
    private readonly requestContext: RequestContextService
  ) {}

  async executer(): Promise<DiagnosticSmtp> {
    const organisationId = this.requestContext.getOrganisationId();
    if (!organisationId) {
      throw new NotFoundException("Organisation introuvable");
    }
    const { boite, identifiants } = await this.resoudreBoite(organisationId);
    const ports = await Promise.all(SONDES_SMTP.map((sonde) => this.sonderPort(sonde, identifiants)));
    return { boite, ports };
  }

  private async resoudreBoite(
    organisationId: string
  ): Promise<{ boite: StatutBoiteDiagnostic; identifiants: Identifiants | null }> {
    if (!(await this.boiteMailDedieeService.trouverActive(organisationId))) {
      return { boite: "non_configuree", identifiants: null };
    }
    try {
      return { boite: "configuree", identifiants: await this.boiteMailDedieeService.obtenirIdentifiants(organisationId) };
    } catch (erreur) {
      this.logger.error(
        `Identifiants de la boîte dédiée illisibles : ${erreur instanceof Error ? erreur.message : String(erreur)}`
      );
      return { boite: "illisible", identifiants: null };
    }
  }

  private creerConnexion(sonde: SondeSmtp): SMTPConnection {
    const implicite = sonde.modeTls === "tls_implicite";
    return new SMTPConnection({
      host: SMTP_HOST,
      port: sonde.port,
      secure: implicite,
      // Refuse de continuer sans chiffrement : jamais d'authentification
      // en clair si STARTTLS manque ou échoue sur le port 587.
      requireTLS: !implicite,
      connectionTimeout: DELAI_CONNEXION_MS,
      greetingTimeout: DELAI_ACCUEIL_MS,
      socketTimeout: DELAI_SOCKET_MS,
      dnsTimeout: DELAI_DNS_MS
    });
  }

  private sonderPort(sonde: SondeSmtp, identifiants: Identifiants | null): Promise<ResultatPortSmtp> {
    const debut = Date.now();
    const starttlsInitial: ResultatEtapeSmtp = sonde.modeTls === "starttls" ? "non_teste" : "non_applicable";
    const connexion = this.creerConnexion(sonde);

    return new Promise((resolve) => {
      let termine = false;
      const terminer = (etapes: Etapes, erreur: ErreurSondeSmtp | null): void => {
        if (termine) {
          return;
        }
        termine = true;
        clearTimeout(plafond);
        connexion.close();
        resolve({ port: sonde.port, modeTls: sonde.modeTls, ...etapes, dureeMs: Date.now() - debut, erreur });
      };

      const plafond = setTimeout(() => {
        terminer(this.etapesDepuisEchec(connexion, undefined, starttlsInitial), { code: "ETIMEDOUT", codeSmtp: null });
      }, PLAFOND_SONDE_MS);

      // Toujours à l'écoute, y compris après la fin de la sonde : un
      // EventEmitter sans écouteur 'error' planterait le processus sur une
      // erreur tardive de fermeture.
      connexion.on("error", (erreur) => {
        terminer(this.etapesDepuisEchec(connexion, erreur, starttlsInitial), normaliserErreur(erreur));
      });

      connexion.connect(() => {
        const etapes: Etapes = {
          connexion: "ok",
          ehlo: "ok",
          starttls: sonde.modeTls === "starttls" ? "ok" : "non_applicable",
          authentification: "non_teste",
          // nodemailer conserve la réponse EHLO brute dans ce champ public
          // au moment où il signale la connexion : c'est celle de la
          // session chiffrée, seule à faire foi après STARTTLS.
          tailleMaxOctets: lireTailleMaxEhlo(connexion.lastServerResponse)
        };
        if (!identifiants) {
          terminer(etapes, null);
          return;
        }
        connexion.login({ user: identifiants.email, pass: identifiants.motDePasseApp }, (erreur) => {
          terminer(
            { ...etapes, authentification: erreur ? "echec" : "ok" },
            erreur ? normaliserErreur(erreur) : null
          );
        });
      });
    });
  }

  private etapesDepuisEchec(
    connexion: SMTPConnection,
    erreur: NodemailerError | undefined,
    starttlsInitial: ResultatEtapeSmtp
  ): Etapes {
    const base = { authentification: "non_teste", tailleMaxOctets: null } as const;
    if (connexion.stage !== "connected") {
      return { ...base, connexion: "echec", ehlo: "non_teste", starttls: starttlsInitial };
    }
    if (erreur?.command === "STARTTLS") {
      return { ...base, connexion: "ok", ehlo: "ok", starttls: "echec" };
    }
    // Échec de l'EHLO, avant STARTTLS ou sur la session déjà chiffrée.
    const starttlsAcquis = starttlsInitial === "non_teste" && connexion.secure;
    return { ...base, connexion: "ok", ehlo: "echec", starttls: starttlsAcquis ? "ok" : starttlsInitial };
  }
}
