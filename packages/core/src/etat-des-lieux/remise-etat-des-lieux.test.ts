import { describe, expect, it } from "vitest";
import {
  adresseEmailPlausible,
  construireDemandeId,
  demandeARejouer,
  destinatairesARenvoyer,
  libelleResultatRemise,
  libellesNonDestinataires,
  lignesResultatRemise,
  selectionInitialeRemise,
  type DestinataireDemande,
  type DestinataireRemise,
  type ResultatEnvoiRemise,
  type StatutEnvoiRemise
} from "./remise-etat-des-lieux";

function resultat(
  locataireId: string,
  statut: StatutEnvoiRemise,
  surcharge: Partial<ResultatEnvoiRemise> = {}
): ResultatEnvoiRemise {
  return {
    locataireId,
    statut,
    tenteLe: "2026-11-03T13:30:00.000Z",
    envoyeLe: statut === "envoye" ? "2026-11-03T13:30:02.000Z" : null,
    messageErreur: null,
    ...surcharge
  };
}

function destinataire(locataireId: string, email: string | null, dernierEnvoi: ResultatEnvoiRemise | null = null): DestinataireRemise {
  return { locataireId, email, dernierEnvoi };
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

describe("construireDemandeId", () => {
  it("produit un UUID v4 valide quels que soient les octets reçus", () => {
    for (const octet of [0x00, 0xff, 0x5a]) {
      expect(construireDemandeId(new Uint8Array(16).fill(octet))).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    }
  });

  it("ne modifie pas les octets fournis", () => {
    const octets = new Uint8Array(16).fill(0xff);

    construireDemandeId(octets);

    expect([...octets].every((o) => o === 0xff)).toBe(true);
  });
});

describe("selectionInitialeRemise", () => {
  it("coche les destinataires avec adresse, jamais ceux déjà envoyés ou sans adresse exploitable", () => {
    expect(
      selectionInitialeRemise([
        destinataire("a", "a@example.com"),
        destinataire("b", null),
        destinataire("c", "invalide"),
        destinataire("d", "d@example.com", resultat("d", "envoye")),
        destinataire("e", "e@example.com", resultat("e", "echec"))
      ])
    ).toEqual(["a", "e"]);
  });
});

describe("libellesNonDestinataires", () => {
  const signataire = (locataireId: string, nomAffiche: string, dernierEnvoi: ResultatEnvoiRemise | null = null) => ({
    ...destinataire(locataireId, null, dernierEnvoi),
    nomAffiche
  });

  it("liste chaque signataire absent de l'envoi, dans l'ordre des signataires", () => {
    expect(
      libellesNonDestinataires(
        [signataire("a", "Camille Essai"), signataire("b", "Dominique Essai"), signataire("c", "Eva Roux")],
        ["a"]
      )
    ).toEqual(["Dominique Essai : non destinataire", "Eva Roux : non destinataire"]);
  });

  it("vide si tous les signataires reçoivent le document", () => {
    expect(libellesNonDestinataires([signataire("a", "Camille Essai")], ["a"])).toEqual([]);
  });

  it("précise quand le signataire a déjà reçu un envoi, jamais pour un simple échec", () => {
    expect(
      libellesNonDestinataires(
        [signataire("a", "Camille Essai", resultat("a", "envoye")), signataire("b", "Dominique Essai", resultat("b", "echec"))],
        []
      )
    ).toEqual([
      "Camille Essai : non destinataire (déjà envoyé le 3 novembre 2026 à 14:30)",
      "Dominique Essai : non destinataire"
    ]);
  });
});

describe("lignesResultatRemise et destinatairesARenvoyer", () => {
  it("un destinataire sans résultat apparaît avec resultat null et reste à renvoyer", () => {
    const lignes = lignesResultatRemise([JEAN, ALEX], [resultat("jean", "envoye")]);

    expect(lignes[1]).toEqual({ destinataire: ALEX, resultat: null });
    expect(destinatairesARenvoyer(lignes)).toEqual(["alex"]);
  });

  it("à renvoyer : échec, résultat inconnu et sans résultat, jamais envoyé ni en cours", () => {
    const lignes = lignesResultatRemise(
      [JEAN, ALEX, { ...ALEX, locataireId: "eva" }, { ...ALEX, locataireId: "luc" }, { ...ALEX, locataireId: "zoe" }],
      [resultat("jean", "envoye"), resultat("alex", "echec"), resultat("eva", "indetermine"), resultat("zoe", "en_cours")]
    );

    expect(destinatairesARenvoyer(lignes)).toEqual(["alex", "eva", "luc"]);
  });
});

describe("demandeARejouer", () => {
  it("réseau coupé ou 5xx : la même demande doit être rejouée", () => {
    expect(demandeARejouer(undefined)).toBe(true);
    expect(demandeARejouer(502)).toBe(true);
  });

  it("refus 4xx : rien n'est parti, la demande est abandonnée", () => {
    expect(demandeARejouer(409)).toBe(false);
    expect(demandeARejouer(400)).toBe(false);
  });
});

describe("libelleResultatRemise", () => {
  it("n'annonce jamais une réception, seulement l'acceptation par le serveur", () => {
    const libelle = libelleResultatRemise(resultat("jean", "envoye"));

    expect(libelle).toContain("Accepté par le serveur d'envoi le 3 novembre 2026");
    expect(libelle).toContain("14:30");
    expect(libelle).not.toMatch(/reçu/i);
  });

  it("reprend le message français de l'échec, avec un repli", () => {
    expect(libelleResultatRemise(resultat("jean", "echec", { messageErreur: "Réessayez." }))).toBe("Réessayez.");
    expect(libelleResultatRemise(resultat("jean", "echec"))).toBe("L'envoi a échoué.");
  });

  it("sans résultat, résultat inconnu et en cours ont leur propre message", () => {
    expect(libelleResultatRemise(null)).toContain("interrompu");
    expect(libelleResultatRemise(resultat("jean", "indetermine"))).toContain("a pu partir");
    expect(libelleResultatRemise(resultat("jean", "en_cours"))).toContain("déjà en cours");
  });
});
