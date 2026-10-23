import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CompteurFenetreFixe,
  entreeExpiree,
  FENETRE_LIMITATION_MS,
  incrementerCompteur,
  LimitationTentativesConnexionService,
  masquerEmail,
  normaliserEmail,
  secondesAvantDeblocage,
  SEUIL_ECHECS_EMAIL,
  SEUIL_ECHECS_IP
} from "./limitation-tentatives-connexion.service";

describe("normaliserEmail", () => {
  it("met en minuscules et retire les espaces en début/fin", () => {
    expect(normaliserEmail("  Jimmy.Test@Example.com ")).toBe("jimmy.test@example.com");
  });

  it("retire aussi les espaces internes (collage accidentel)", () => {
    expect(normaliserEmail("jim my@example.com")).toBe("jimmy@example.com");
  });
});

describe("masquerEmail", () => {
  it("garde la première lettre et le domaine, masque le reste", () => {
    expect(masquerEmail("jimmy@example.com")).toBe("j***@example.com");
  });

  it("fonctionne même pour une partie locale d'une seule lettre", () => {
    expect(masquerEmail("j@example.com")).toBe("j***@example.com");
  });

  it("retombe sur *** si l'entrée n'a pas la forme d'un email", () => {
    expect(masquerEmail("pas-un-email")).toBe("***");
  });
});

describe("incrementerCompteur / secondesAvantDeblocage (fenêtre fixe)", () => {
  const T0 = 1_000_000;

  it("premier échec : fenêtre ouverte à 1, jamais bloqué avant le seuil", () => {
    const compteur = incrementerCompteur(undefined, T0);
    expect(compteur).toEqual({ echecs: 1, debutFenetre: T0 });
    expect(secondesAvantDeblocage(compteur, SEUIL_ECHECS_IP, T0)).toBe(0);
  });

  it("bloque exactement au seuil, pas avant", () => {
    let compteur: CompteurFenetreFixe | undefined;
    for (let i = 0; i < SEUIL_ECHECS_IP - 1; i++) {
      compteur = incrementerCompteur(compteur, T0);
    }
    expect(secondesAvantDeblocage(compteur, SEUIL_ECHECS_IP, T0)).toBe(0);

    compteur = incrementerCompteur(compteur, T0);
    expect(compteur.echecs).toBe(SEUIL_ECHECS_IP);
    expect(secondesAvantDeblocage(compteur, SEUIL_ECHECS_IP, T0)).toBeGreaterThan(0);
  });

  it("le délai restant diminue avec le temps et tombe à 0 à l'expiration de la fenêtre", () => {
    let compteur: CompteurFenetreFixe | undefined;
    for (let i = 0; i < SEUIL_ECHECS_IP; i++) {
      compteur = incrementerCompteur(compteur, T0);
    }

    expect(secondesAvantDeblocage(compteur, SEUIL_ECHECS_IP, T0)).toBe(Math.ceil(FENETRE_LIMITATION_MS / 1000));
    expect(secondesAvantDeblocage(compteur, SEUIL_ECHECS_IP, T0 + FENETRE_LIMITATION_MS - 1000)).toBe(1);
    expect(secondesAvantDeblocage(compteur, SEUIL_ECHECS_IP, T0 + FENETRE_LIMITATION_MS)).toBe(0);
  });

  it("un nouvel échec après expiration de la fenêtre repart à 1, pas un cumul", () => {
    const premier = incrementerCompteur(undefined, T0);
    const apresExpiration = incrementerCompteur(premier, T0 + FENETRE_LIMITATION_MS + 1);
    expect(apresExpiration).toEqual({ echecs: 1, debutFenetre: T0 + FENETRE_LIMITATION_MS + 1 });
  });

  it("entreeExpiree reflète la même règle de fenêtre", () => {
    const compteur = incrementerCompteur(undefined, T0);
    expect(entreeExpiree(compteur, T0 + FENETRE_LIMITATION_MS - 1)).toBe(false);
    expect(entreeExpiree(compteur, T0 + FENETRE_LIMITATION_MS)).toBe(true);
  });
});

describe("LimitationTentativesConnexionService", () => {
  let service: LimitationTentativesConnexionService;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new LimitationTentativesConnexionService();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("autorise par défaut et réserve la tentative (aucun blocage, aucun WARN)", () => {
    expect(service.reserverTentative("1.2.3.4", "jimmy@example.com")).toEqual({ bloque: false, retryAfterSeconds: 0 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it(`bloque l'IP au ${SEUIL_ECHECS_IP}e appel, même avec des e-mails ciblés distincts`, () => {
    for (let i = 0; i < SEUIL_ECHECS_IP; i++) {
      service.reserverTentative("1.2.3.4", `cible-${i}@example.com`);
    }
    const resultat = service.reserverTentative("1.2.3.4", "cible-nouvelle@example.com");
    expect(resultat.bloque).toBe(true);
    expect(resultat.retryAfterSeconds).toBeGreaterThan(0);
  });

  it(`bloque l'e-mail au ${SEUIL_ECHECS_EMAIL}e appel même depuis des IP différentes`, () => {
    for (let i = 0; i < SEUIL_ECHECS_EMAIL; i++) {
      service.reserverTentative(`1.2.3.${i}`, "cible@example.com");
    }
    expect(service.reserverTentative("9.9.9.9", "cible@example.com").bloque).toBe(true);
  });

  it("l'axe e-mail suit la normalisation (casse et espaces)", () => {
    for (let i = 0; i < SEUIL_ECHECS_EMAIL; i++) {
      service.reserverTentative(`1.2.3.${i}`, "Cible@Example.com");
    }
    expect(service.reserverTentative("9.9.9.9", "cible@example.com").bloque).toBe(true);
  });

  it("reserverTentative(ip, email) incrémente IP et e-mail dans le même appel synchrone (réservation pessimiste)", () => {
    service.reserverTentative("1.2.3.4", "cible@example.com");
    // Encore SEUIL_ECHECS_IP - 1 réservations possibles côté IP avant blocage.
    for (let i = 0; i < SEUIL_ECHECS_IP - 1; i++) {
      expect(service.reserverTentative("1.2.3.4", `autre-${i}@example.com`).bloque).toBe(false);
    }
    expect(service.reserverTentative("1.2.3.4", "encore-un-autre@example.com").bloque).toBe(true);
  });

  it("enregistrerSucces remet à zéro l'IP ET décrémente l'e-mail de 1 (annule la réservation pessimiste)", () => {
    service.reserverTentative("1.2.3.4", "cible@example.com"); // réservation pessimiste : IP=1, email=1
    service.enregistrerSucces("1.2.3.4", "cible@example.com"); // IP→0 (supprimé), email→0 (supprimé)

    // IP repartie à zéro : il faut à nouveau SEUIL_ECHECS_IP réservations
    // avant que la suivante ne soit bloquée — même comportement qu'une IP
    // qui n'aurait jamais échoué (le blocage ne se manifeste qu'à l'appel
    // QUI SUIT celui qui atteint le seuil, voir le test de
    // secondesAvantDeblocage ci-dessus).
    for (let i = 0; i < SEUIL_ECHECS_IP; i++) {
      expect(service.reserverTentative("1.2.3.4", "cible@example.com").bloque).toBe(false);
    }
    expect(service.reserverTentative("1.2.3.4", "cible@example.com").bloque).toBe(true);
  });

  it("enregistrerSucces décrémente l'e-mail d'exactement 1 (pas une remise à zéro) : la pression accumulée par un tiers n'est pas effacée", () => {
    // 9 échecs réels côté e-mail depuis d'autres IP (simule un attaquant distribué).
    for (let i = 0; i < SEUIL_ECHECS_EMAIL - 1; i++) {
      service.reserverTentative(`10.0.0.${i}`, "cible@example.com");
    }
    // Le vrai titulaire réserve puis réussit depuis SA propre IP : la
    // réservation pessimiste (email → 10) est immédiatement annulée par
    // le succès (email → 9), pas remise à 0.
    service.reserverTentative("10.0.0.254", "cible@example.com");
    service.enregistrerSucces("10.0.0.254", "cible@example.com");

    // Si enregistrerSucces avait remis l'e-mail à 0, il faudrait encore
    // SEUIL_ECHECS_EMAIL échecs pour rebloquer. Avec un simple décrément
    // de 1, un seul échec supplémentaire (10e) suffit à atteindre le
    // seuil, et le suivant (11e) est bloqué.
    expect(service.reserverTentative("10.0.0.255", "cible@example.com").bloque).toBe(false); // 10e échec : atteint le seuil
    expect(service.reserverTentative("10.0.0.256", "cible@example.com").bloque).toBe(true); // 11e échec : bloqué
  });

  it("ne journalise jamais le mot de passe et masque l'e-mail dans le WARN de blocage", () => {
    for (let i = 0; i < SEUIL_ECHECS_IP; i++) {
      service.reserverTentative("1.2.3.4", "jimmy@example.com");
    }
    service.reserverTentative("1.2.3.4", "jimmy@example.com");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls.at(-1)?.[0] as string;
    expect(message).toContain("ip=1.2.3.4");
    expect(message).toContain("j***@example.com");
    expect(message).not.toContain("jimmy@example.com");
    expect(message.toLowerCase()).not.toContain("mot de passe");
  });

  it("nettoyerEntreesExpirees retire les entrées expirées sans perturber une entrée récente", () => {
    service.reserverTentative("1.2.3.4", "ancien@example.com");
    vi.setSystemTime(FENETRE_LIMITATION_MS + 1);
    service.reserverTentative("5.6.7.8", "recent@example.com");

    service.nettoyerEntreesExpirees();

    for (let i = 0; i < SEUIL_ECHECS_IP - 1; i++) {
      service.reserverTentative("5.6.7.8", "recent@example.com");
    }
    // L'entrée récente n'a pas été repartie à 0 par le nettoyage : elle
    // atteint bien le seuil après le nombre d'appels attendu.
    expect(service.reserverTentative("5.6.7.8", "recent@example.com").bloque).toBe(true);
  });
});
