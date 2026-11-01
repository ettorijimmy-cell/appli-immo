import { describe, expect, it } from "vitest";
import type { DestinataireEnvoi, ResultatEnvoi } from "../api/etats-des-lieux";
import { ApiError } from "../lib/authenticated-fetch";
import {
  adresseEmailPlausible,
  aRenvoyer,
  demandeARejouer,
  genererDemandeId,
  libelleResultat,
  lignesResultat,
  selectionInitiale,
  type DestinataireDemande
} from "./remise-etat-des-lieux";

function resultat(locataireId: string, statut: ResultatEnvoi["statut"], surcharge: Partial<ResultatEnvoi> = {}): ResultatEnvoi {
  return {
    locataireId,
    nomDestinataire: locataireId,
    adresseUtilisee: `${locataireId}@example.com`,
    statut,
    tenteLe: "2026-11-03T13:30:00.000Z",
    envoyeLe: statut === "envoye" ? "2026-11-03T13:30:02.000Z" : null,
    codeErreur: null,
    messageErreur: null,
    ...surcharge
  };
}

function destinataire(locataireId: string, email: string | null, dernierEnvoi: ResultatEnvoi | null = null): DestinataireEnvoi {
  return { locataireId, nomAffiche: locataireId, email, dernierEnvoi };
}

const JEAN: DestinataireDemande = { locataireId: "jean", nomAffiche: "Jean", email: "jean@example.com" };
const ALEX: DestinataireDemande = { locataireId: "alex", nomAffiche: "Alex", email: "alex@example.com" };

describe("adresseEmailPlausible", () => {
  it.each(["jean@example.com", "j+x@sous.example.fr"])("accepte %s", (adresse) => {
    expect(adresseEmailPlausible(adresse)).toBe(true);
  });

  it.each(["", "jean", "jean@", "jean@example", "a@b.fr,c@d.fr", "a@b.fr;c@d.fr", "a b@example.com", "<a@b.fr>"])(
    "refuse %s",
    (adresse) => {
      expect(adresseEmailPlausible(adresse)).toBe(false);
    }
  );
});

describe("genererDemandeId", () => {
  it("produit un UUID v4 valide, différent à chaque appel", () => {
    const a = genererDemandeId();

    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(genererDemandeId()).not.toBe(a);
  });
});

describe("selectionInitiale", () => {
  it("coche les destinataires avec adresse, jamais ceux déjà envoyés ou sans adresse exploitable", () => {
    expect(
      selectionInitiale([
        destinataire("a", "a@example.com"),
        destinataire("b", null),
        destinataire("c", "invalide"),
        destinataire("d", "d@example.com", resultat("d", "envoye")),
        destinataire("e", "e@example.com", resultat("e", "echec"))
      ])
    ).toEqual(["a", "e"]);
  });
});

describe("lignesResultat et aRenvoyer", () => {
  it("un destinataire sans résultat apparaît avec resultat null et reste à renvoyer", () => {
    const lignes = lignesResultat([JEAN, ALEX], [resultat("jean", "envoye")]);

    expect(lignes[1]).toEqual({ destinataire: ALEX, resultat: null });
    expect(aRenvoyer(lignes)).toEqual(["alex"]);
  });

  it("à renvoyer : échec, résultat inconnu et sans résultat, jamais envoyé ni en cours", () => {
    const lignes = lignesResultat(
      [JEAN, ALEX, { ...ALEX, locataireId: "eva" }, { ...ALEX, locataireId: "luc" }, { ...ALEX, locataireId: "zoe" }],
      [resultat("jean", "envoye"), resultat("alex", "echec"), resultat("eva", "indetermine"), resultat("zoe", "en_cours")]
    );

    expect(aRenvoyer(lignes)).toEqual(["alex", "eva", "luc"]);
  });
});

describe("demandeARejouer", () => {
  it("réseau coupé ou 5xx : la même demande doit être rejouée", () => {
    expect(demandeARejouer(new TypeError("Failed to fetch"))).toBe(true);
    expect(demandeARejouer(new ApiError(502))).toBe(true);
  });

  it("refus 4xx : rien n'est parti, la demande est abandonnée", () => {
    expect(demandeARejouer(new ApiError(409))).toBe(false);
    expect(demandeARejouer(new ApiError(400))).toBe(false);
  });
});

describe("libelleResultat", () => {
  it("n'annonce jamais une réception, seulement l'acceptation par le serveur", () => {
    const libelle = libelleResultat(resultat("jean", "envoye"));

    expect(libelle).toContain("Accepté par le serveur d'envoi le 3 novembre 2026");
    expect(libelle).toContain("14:30");
    expect(libelle).not.toMatch(/reçu/i);
  });

  it("reprend le message français de l'échec", () => {
    expect(libelleResultat(resultat("jean", "echec", { messageErreur: "Réessayez." }))).toBe("Réessayez.");
  });

  it("sans résultat et résultat inconnu ont leur propre message", () => {
    expect(libelleResultat(null)).toContain("interrompu");
    expect(libelleResultat(resultat("jean", "indetermine"))).toContain("a pu partir");
  });
});
