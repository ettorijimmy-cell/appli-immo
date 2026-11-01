import { EventEmitter } from "events";
import { Logger, NotFoundException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContextService } from "../common/request-context";
import type { BoiteMailDedieeService } from "../messagerie/boite-mail-dediee.service";
import { DiagnosticSmtpService, lireTailleMaxEhlo } from "./diagnostic-smtp.service";

const EHLO_CHIFFRE = "250-smtp.gmail.com at your service\r\n250-SIZE 35882577\r\n250-8BITMIME\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8";
const MOT_DE_PASSE = "mot-de-passe-tres-sensible";
const EMAIL = "boite-dediee@example.com";

type Scenario = {
  stage?: "init" | "connected";
  secure?: boolean;
  erreurConnexion?: { code?: string; command?: string; responseCode?: number; message?: string; response?: string };
  erreurLogin?: { code?: string; responseCode?: number; message?: string; response?: string };
  silence?: boolean;
};

class ConnexionFactice extends EventEmitter {
  static instances: ConnexionFactice[] = [];
  static scenarios: Record<number, Scenario> = {};

  stage: "init" | "connected" = "init";
  secure = false;
  lastServerResponse: string | false = false;
  close = vi.fn();
  send = vi.fn();
  login = vi.fn((_auth: unknown, callback: (erreur?: unknown) => void) => {
    callback(this.scenario.erreurLogin);
  });

  constructor(public readonly options: { port: number; secure: boolean; requireTLS: boolean }) {
    super();
    ConnexionFactice.instances.push(this);
  }

  get scenario(): Scenario {
    return ConnexionFactice.scenarios[this.options.port] ?? {};
  }

  connect(callback: () => void): void {
    if (this.scenario.silence) {
      return;
    }
    this.stage = this.scenario.stage ?? "connected";
    this.secure = this.scenario.secure ?? true;
    if (this.scenario.erreurConnexion) {
      this.emit("error", this.scenario.erreurConnexion);
      return;
    }
    this.lastServerResponse = EHLO_CHIFFRE;
    callback();
  }
}

vi.mock("nodemailer/lib/smtp-connection", () => ({ default: vi.fn((options) => new ConnexionFactice(options)) }));

function creerService(options: {
  organisationId?: string | null;
  boiteActive?: boolean;
  obtenirIdentifiants?: () => Promise<{ email: string; motDePasseApp: string }>;
}): { service: DiagnosticSmtpService; obtenirIdentifiants: ReturnType<typeof vi.fn> } {
  const obtenirIdentifiants = vi.fn(
    options.obtenirIdentifiants ?? (async () => ({ email: EMAIL, motDePasseApp: MOT_DE_PASSE }))
  );
  const boite = {
    trouverActive: vi.fn(async () => (options.boiteActive === false ? null : { id: "boite" })),
    obtenirIdentifiants
  } as unknown as BoiteMailDedieeService;
  const contexte = {
    getOrganisationId: () => (options.organisationId === undefined ? "organisation" : options.organisationId)
  } as unknown as RequestContextService;
  return { service: new DiagnosticSmtpService(boite, contexte), obtenirIdentifiants };
}

describe("lireTailleMaxEhlo", () => {
  it("lit SIZE dans une réponse EHLO multiligne", () => {
    expect(lireTailleMaxEhlo(EHLO_CHIFFRE)).toBe(35882577);
  });

  it("lit SIZE quand c'est la dernière ligne de la réponse", () => {
    expect(lireTailleMaxEhlo("250-smtp.example.com\r\n250 SIZE 1000")).toBe(1000);
  });

  it("null si SIZE est absent, sans valeur, ou si la réponse manque", () => {
    expect(lireTailleMaxEhlo("250-smtp.example.com\r\n250 8BITMIME")).toBeNull();
    expect(lireTailleMaxEhlo("250-smtp.example.com\r\n250 SIZE")).toBeNull();
    expect(lireTailleMaxEhlo(false)).toBeNull();
  });
});

describe("DiagnosticSmtpService", () => {
  beforeEach(() => {
    ConnexionFactice.instances = [];
    ConnexionFactice.scenarios = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejette sans contexte organisation, sans aucune connexion", async () => {
    const { service } = creerService({ organisationId: null });

    await expect(service.executer()).rejects.toThrow(NotFoundException);
    expect(ConnexionFactice.instances).toHaveLength(0);
  });

  it("sonde 465 en TLS implicite et 587 en STARTTLS obligatoire", async () => {
    const { service } = creerService({});

    await service.executer();

    expect(ConnexionFactice.instances.map((c) => c.options)).toEqual([
      expect.objectContaining({ host: "smtp.gmail.com", port: 465, secure: true, requireTLS: false }),
      expect.objectContaining({ host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true })
    ]);
  });

  it("boîte configurée, réseau ouvert : toutes les étapes ok, SIZE lu sur chaque port", async () => {
    const { service } = creerService({});

    const resultat = await service.executer();

    expect(resultat).toEqual({
      boite: "configuree",
      ports: [
        {
          port: 465,
          modeTls: "tls_implicite",
          connexion: "ok",
          ehlo: "ok",
          starttls: "non_applicable",
          authentification: "ok",
          tailleMaxOctets: 35882577,
          dureeMs: expect.any(Number),
          erreur: null
        },
        {
          port: 587,
          modeTls: "starttls",
          connexion: "ok",
          ehlo: "ok",
          starttls: "ok",
          authentification: "ok",
          tailleMaxOctets: 35882577,
          dureeMs: expect.any(Number),
          erreur: null
        }
      ]
    });
  });

  it("n'envoie jamais de mail et ferme chaque connexion", async () => {
    const { service } = creerService({});

    await service.executer();

    for (const connexion of ConnexionFactice.instances) {
      expect(connexion.send).not.toHaveBeenCalled();
      expect(connexion.close).toHaveBeenCalledTimes(1);
    }
  });

  it("un port bloqué n'empêche pas de conclure sur l'autre", async () => {
    ConnexionFactice.scenarios[465] = {
      stage: "init",
      erreurConnexion: { code: "ETIMEDOUT", command: "CONN", message: "Connection timeout" }
    };
    const { service } = creerService({});

    const { ports } = await service.executer();

    expect(ports[0]).toMatchObject({
      connexion: "echec",
      ehlo: "non_teste",
      starttls: "non_applicable",
      authentification: "non_teste",
      tailleMaxOctets: null,
      erreur: { code: "ETIMEDOUT", codeSmtp: null }
    });
    expect(ports[1]).toMatchObject({ connexion: "ok", authentification: "ok", erreur: null });
  });

  it("587 refusé à la connexion : STARTTLS reste non testé", async () => {
    ConnexionFactice.scenarios[587] = {
      stage: "init",
      erreurConnexion: { code: "ECONNECTION", command: "CONN" }
    };
    const { service } = creerService({});

    const { ports } = await service.executer();

    expect(ports[1]).toMatchObject({ connexion: "echec", ehlo: "non_teste", starttls: "non_teste" });
  });

  it("échec de STARTTLS : EHLO acquis, authentification jamais tentée", async () => {
    ConnexionFactice.scenarios[587] = {
      secure: false,
      erreurConnexion: { code: "ETLS", command: "STARTTLS", responseCode: 454 }
    };
    const { service } = creerService({});

    const { ports } = await service.executer();

    expect(ports[1]).toMatchObject({
      connexion: "ok",
      ehlo: "ok",
      starttls: "echec",
      authentification: "non_teste",
      erreur: { code: "ETLS", codeSmtp: 454 }
    });
    expect(ConnexionFactice.instances[1]?.login).not.toHaveBeenCalled();
  });

  it("échec du premier EHLO, avant tout chiffrement : STARTTLS non testé", async () => {
    ConnexionFactice.scenarios[587] = {
      secure: false,
      erreurConnexion: { code: "ECONNECTION", command: "EHLO", responseCode: 421 }
    };
    const { service } = creerService({});

    const { ports } = await service.executer();

    expect(ports[1]).toMatchObject({ connexion: "ok", ehlo: "echec", starttls: "non_teste" });
  });

  it("échec de l'EHLO sur la session chiffrée : STARTTLS reste acquis", async () => {
    ConnexionFactice.scenarios[587] = {
      secure: true,
      erreurConnexion: { code: "ECONNECTION", command: "EHLO", responseCode: 421 }
    };
    const { service } = creerService({});

    const { ports } = await service.executer();

    expect(ports[1]).toMatchObject({ connexion: "ok", ehlo: "echec", starttls: "ok" });
  });

  it("mot de passe refusé : authentification en échec, SIZE conservé", async () => {
    ConnexionFactice.scenarios[587] = { erreurLogin: { code: "EAUTH", responseCode: 535 } };
    const { service } = creerService({});

    const { ports } = await service.executer();

    expect(ports[1]).toMatchObject({
      authentification: "echec",
      tailleMaxOctets: 35882577,
      erreur: { code: "EAUTH", codeSmtp: 535 }
    });
  });

  it("sans boîte configurée : teste quand même le réseau, sans lire d'identifiants", async () => {
    const { service, obtenirIdentifiants } = creerService({ boiteActive: false });

    const resultat = await service.executer();

    expect(resultat.boite).toBe("non_configuree");
    expect(obtenirIdentifiants).not.toHaveBeenCalled();
    expect(resultat.ports.map((p) => [p.connexion, p.authentification])).toEqual([
      ["ok", "non_teste"],
      ["ok", "non_teste"]
    ]);
    expect(ConnexionFactice.instances.every((c) => c.login.mock.calls.length === 0)).toBe(true);
  });

  it("mot de passe indéchiffrable : statut 'illisible', réseau testé, cause seulement journalisée", async () => {
    const journal = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { service } = creerService({
      obtenirIdentifiants: async () => {
        throw new Error("Unsupported state or unable to authenticate data");
      }
    });

    const resultat = await service.executer();

    expect(resultat.boite).toBe("illisible");
    expect(resultat.ports.every((p) => p.authentification === "non_teste")).toBe(true);
    expect(JSON.stringify(resultat)).not.toContain("Unsupported state");
    expect(journal).toHaveBeenCalledWith(expect.stringContaining("Unsupported state"));
  });

  it("une connexion muette se conclut au plafond et reste fermée", async () => {
    vi.useFakeTimers();
    ConnexionFactice.scenarios[465] = { silence: true };
    ConnexionFactice.scenarios[587] = { silence: true };
    const { service } = creerService({});

    const promesse = service.executer();
    await vi.advanceTimersByTimeAsync(45_000);
    const { ports } = await promesse;

    expect(ports.map((p) => [p.connexion, p.erreur?.code])).toEqual([
      ["echec", "ETIMEDOUT"],
      ["echec", "ETIMEDOUT"]
    ]);
    expect(ConnexionFactice.instances.every((c) => c.close.mock.calls.length === 1)).toBe(true);
  });

  it("une erreur tardive après la fin de la sonde est absorbée sans modifier le résultat", async () => {
    const { service } = creerService({});

    const { ports } = await service.executer();

    expect(() => ConnexionFactice.instances[0]?.emit("error", { code: "ESOCKET" })).not.toThrow();
    expect(ports[0]?.erreur).toBeNull();
  });

  it("aucun secret, adresse ni texte serveur dans la réponse", async () => {
    const textePiege = `535 refus pour ${EMAIL} avec ${MOT_DE_PASSE}`;
    ConnexionFactice.scenarios[465] = {
      erreurLogin: { code: "EAUTH", responseCode: 535, message: textePiege, response: textePiege }
    };
    ConnexionFactice.scenarios[587] = {
      erreurLogin: { code: textePiege, message: textePiege, response: textePiege }
    };
    const { service } = creerService({});

    const resultat = await service.executer();

    const texte = JSON.stringify(resultat);
    expect(texte).not.toContain(MOT_DE_PASSE);
    expect(texte).not.toContain(EMAIL);
    expect(resultat.ports[1]?.erreur).toEqual({ code: "INCONNU", codeSmtp: null });
  });
});
