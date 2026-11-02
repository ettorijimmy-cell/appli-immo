import { expect, test, type Page, type Route } from "@playwright/test";

// La vraie page dans un vrai navigateur (Chromium, largeur de téléphone) :
// backend simulé par page.route(), à partir d'un état modifiable par test.

const EDL_ID = "edl-test";
const JEAN = "loc-jean";
const ALEX = "loc-alex";
const EMAIL_JEAN = "jean.dupont@example.com";
const EMAIL_ALEX = "alex.martin@example.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS"
};

interface Destinataire {
  locataireId: string;
  nomAffiche: string;
  email: string | null;
  dernierEnvoi: unknown;
}

interface EtatSimule {
  autrePiece1: string | null;
  refusPieceAutre: string | null;
  statut: "non_commence" | "entree_terminee" | "complet";
  entreeSignee: boolean;
  sortieSignee: boolean;
  pdfPretApres: number;
  lecturesDestinataires: number;
  destinataires: Destinataire[];
  appelsEnvoi: { demandeId: string; destinataires: { locataireId: string; email: string }[] }[];
  appelsPatch: { url: string; corps: unknown }[];
  appelsProductionPdf: number;
  appelsSignature: number;
  repondreEnvoi: (route: Route, corps: EtatSimule["appelsEnvoi"][number]) => Promise<void>;
  repondreSignature: ((route: Route) => Promise<void>) | null;
  rechargementEnPanne: boolean;
}

function json(route: Route, corps: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(corps) });
}

function resultat(locataireId: string, statut: string, surcharge: Record<string, unknown> = {}) {
  return {
    locataireId,
    nomDestinataire: locataireId === JEAN ? "Jean Dupont" : "Alex Martin",
    adresseUtilisee: locataireId === JEAN ? EMAIL_JEAN : EMAIL_ALEX,
    statut,
    tenteLe: "2026-11-03T13:30:00.000Z",
    envoyeLe: statut === "envoye" ? "2026-11-03T13:30:02.000Z" : null,
    codeErreur: null,
    messageErreur: null,
    ...surcharge
  };
}

function etatInitial(surcharge: Partial<EtatSimule> = {}): EtatSimule {
  return {
    autrePiece1: null,
    refusPieceAutre: null,
    statut: "entree_terminee",
    entreeSignee: true,
    sortieSignee: false,
    pdfPretApres: 0,
    lecturesDestinataires: 0,
    destinataires: [
      { locataireId: JEAN, nomAffiche: "Jean Dupont", email: EMAIL_JEAN, dernierEnvoi: null },
      { locataireId: ALEX, nomAffiche: "Alex Martin", email: EMAIL_ALEX, dernierEnvoi: null }
    ],
    appelsEnvoi: [],
    appelsPatch: [],
    appelsProductionPdf: 0,
    appelsSignature: 0,
    repondreEnvoi: (route, corps) =>
      json(route, { resultats: corps.destinataires.map((d) => resultat(d.locataireId, "envoye")) }),
    repondreSignature: null,
    rechargementEnPanne: false,
    ...surcharge
  };
}

function etatDesLieuxComplet(etat: EtatSimule) {
  return {
    id: EDL_ID,
    bailId: "bail-test",
    dateEntree: etat.entreeSignee ? "2026-08-01" : null,
    dateSortie: etat.sortieSignee ? "2026-11-03" : null,
    lieuEntree: "Paris",
    lieuSortie: null,
    nouvelleAdresseLocataire: null,
    statut: etat.statut,
    archivedAt: null,
    entreeSigneeParTous: etat.entreeSignee,
    sortieSigneeParTous: etat.sortieSignee,
    entree: null,
    sejour: null,
    cuisine: null,
    chambres: [],
    sallesDeBain: [],
    wc: [],
    autres: [],
    compteurs: null,
    cles: [],
    equipementsDivers: [],
    inventaire: []
  };
}

async function simulerBackend(page: Page, etat: EtatSimule): Promise<void> {
  await page.route("http://localhost:3000/**", async (route) => {
    const requete = route.request();
    const { pathname, search } = new URL(requete.url());
    const methode = requete.method();

    if (methode === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (pathname === "/baux/bail-test") {
      return json(route, { id: "bail-test", appartementId: "appt", typeBail: "vide", statut: "actif", dateDebut: "2026-08-01", dateFin: null, archivedAt: null });
    }
    if (pathname === "/appartements/appt") {
      return json(route, { id: "appt", bienId: "bien", numero: "1", nombreChambres: 0, nombreSallesDeBain: 0, nombreWc: 0, autrePiece1: etat.autrePiece1, autrePiece2: null });
    }
    if (pathname === "/etats-des-lieux" && search.includes("bailId")) {
      return etat.rechargementEnPanne ? json(route, { message: "Panne" }, 500) : json(route, etatDesLieuxComplet(etat));
    }
    if (pathname.endsWith("/piece-autre") && etat.refusPieceAutre) {
      return json(route, { message: etat.refusPieceAutre }, 409);
    }
    if (pathname.endsWith("/signataires")) {
      return json(route, {
        villeLogement: "Paris",
        bailleurNomPropose: "SCI Turgot",
        nouvelleAdresseLocataire: "1 rue du Départ, 69001 Lyon",
        locataires: [{ locataireId: JEAN, nomAffiche: "Jean Dupont" }],
        entreeSignee: etat.entreeSignee,
        sortieSignee: etat.sortieSignee
      });
    }
    if (pathname.endsWith("/signer-sortie") || pathname.endsWith("/signer-entree")) {
      etat.appelsSignature++;
      if (etat.repondreSignature) {
        return etat.repondreSignature(route);
      }
      etat.sortieSignee = true;
      etat.statut = "complet";
      return json(route, etatDesLieuxComplet(etat));
    }
    if (pathname.endsWith("/destinataires")) {
      etat.lecturesDestinataires++;
      return json(route, {
        pdfDisponible: etat.lecturesDestinataires > etat.pdfPretApres,
        destinataires: etat.destinataires
      });
    }
    if (pathname.startsWith("/locataires/") && methode === "PATCH") {
      const corps = requete.postDataJSON() as { email: string };
      etat.appelsPatch.push({ url: pathname, corps });
      const cible = etat.destinataires.find((d) => pathname.endsWith(d.locataireId));
      if (cible) {
        cible.email = corps.email;
      }
      return json(route, {});
    }
    if (/\/pdf\/(entree|sortie)$/.test(pathname) && methode === "POST") {
      etat.appelsProductionPdf++;
      etat.pdfPretApres = 0;
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (/\/envois\/(entree|sortie)$/.test(pathname) && methode === "POST") {
      const corps = requete.postDataJSON() as EtatSimule["appelsEnvoi"][number];
      etat.appelsEnvoi.push(corps);
      return etat.repondreEnvoi(route, corps);
    }
    // Soumission d'une étape du parcours : accusée sans contenu.
    return json(route, {});
  });
}

async function ouvrirPanneauEntree(page: Page): Promise<void> {
  await page.goto("/test-harness/remise.html");
  await page.getByRole("button", { name: "Envoyer l'état des lieux d'entrée" }).click();
  await expect(page.getByText("PDF prêt.")).toBeVisible();
}

async function confirmer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer l'envoi" }).click();
}

// Parcourt réellement les étapes jusqu'à la signature.
async function allerALaSignature(page: Page): Promise<void> {
  await page.goto("/test-harness/remise.html");
  // Le libellé du bouton dit où en est le parcours : aucune attente fixe.
  const bouton = page.getByRole("button", { name: /^(Suivant|Terminer)$/ });
  for (let i = 0; i < 10; i++) {
    await expect(bouton).toBeVisible();
    if ((await bouton.textContent()) === "Terminer") {
      break;
    }
    await bouton.click();
  }
  await expect(page.getByText("Signature de la sortie")).toBeVisible();
}

async function signer(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const cases = page.getByRole("checkbox");
  for (const rang of [0, 1]) {
    await cases.nth(rang).check();
    const canvas = page.getByRole("img", { name: "Zone de signature" }).nth(rang);
    await canvas.scrollIntoViewIfNeeded();
    const boite = await canvas.boundingBox();
    if (!boite) {
      throw new Error("Zone de signature introuvable");
    }
    const points = Array.from({ length: 8 }, (_, i) => ({
      x: boite.x + (boite.width * i) / 8,
      y: boite.y + boite.height * 0.3 + (i % 2) * 20
    }));
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.slice(0, 1) });
    for (const point of points.slice(1)) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
}

test("page : un bouton par phase signée, y compris au milieu du parcours de sortie, sans perdre l'étape", async ({ page }) => {
  const etat = etatInitial();
  await simulerBackend(page, etat);
  await page.goto("/test-harness/remise.html");

  await expect(page.getByRole("button", { name: "Envoyer l'état des lieux d'entrée" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Envoyer l'état des lieux de sortie" })).toHaveCount(0);

  await page.getByRole("button", { name: "Suivant" }).click();
  await expect(page.getByText(/Séjour 2\//)).toBeVisible();

  await page.getByRole("button", { name: "Envoyer l'état des lieux d'entrée" }).click();
  await expect(page.getByText("Remise de l'état des lieux d'entrée")).toBeVisible();
  await page.getByRole("button", { name: "Retour" }).click();

  await expect(page.getByText(/Séjour 2\//)).toBeVisible();
});

test("page : état des lieux complet, les deux phases restent accessibles", async ({ page }) => {
  await simulerBackend(page, etatInitial({ statut: "complet", sortieSignee: true }));
  await page.goto("/test-harness/remise.html");

  await expect(page.getByRole("button", { name: "Envoyer l'état des lieux d'entrée" })).toBeVisible();
  await page.getByRole("button", { name: "Envoyer l'état des lieux de sortie" }).click();

  await expect(page.getByText("Remise de l'état des lieux de sortie")).toBeVisible();
});

test("page : aucune phase signée, aucun bouton d'envoi", async ({ page }) => {
  await simulerBackend(page, etatInitial({ statut: "non_commence", entreeSignee: false }));
  await page.goto("/test-harness/remise.html");

  await expect(page.getByRole("button", { name: "Suivant" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Envoyer l'état des lieux/ })).toHaveCount(0);
});

test("après signature : le panneau s'ouvre seul, PDF en préparation puis prêt, rien ne part sans confirmation", async ({ page }) => {
  // Le test décide lui-même quand le PDF arrive : aucune fenêtre de temps à viser.
  const etat = etatInitial({ pdfPretApres: 1_000 });
  await simulerBackend(page, etat);
  await allerALaSignature(page);
  await signer(page);

  await page.getByRole("button", { name: "Terminer" }).click();

  await expect(page.getByText("Remise de l'état des lieux de sortie")).toBeVisible();
  await expect(page.getByText("PDF en préparation")).toBeVisible();
  etat.pdfPretApres = 0;
  await expect(page.getByText("PDF prêt.")).toBeVisible({ timeout: 8000 });
  expect(etat.appelsEnvoi).toHaveLength(0);
});

test("confirmation : liste nom et adresse, Annuler n'envoie rien, Confirmer envoie une fois", async ({ page }) => {
  const etat = etatInitial();
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true }).click();
  await expect(page.getByText(/Jean Dupont\s+—\s+jean\.dupont@example\.com/)).toBeVisible();
  await expect(page.getByText(/Alex Martin\s+—\s+alex\.martin@example\.com/)).toBeVisible();

  await page.getByRole("button", { name: "Annuler" }).click();
  expect(etat.appelsEnvoi).toHaveLength(0);

  await confirmer(page);

  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(2);
  expect(etat.appelsEnvoi).toHaveLength(1);
  expect(etat.appelsEnvoi[0]?.destinataires).toEqual([
    { locataireId: JEAN, email: EMAIL_JEAN },
    { locataireId: ALEX, email: EMAIL_ALEX }
  ]);
});

test("un destinataire décoché ne reçoit rien", async ({ page }) => {
  const etat = etatInitial();
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await page.getByRole("checkbox").nth(1).uncheck();
  await confirmer(page);

  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(1);
  expect(etat.appelsEnvoi[0]?.destinataires).toEqual([{ locataireId: JEAN, email: EMAIL_JEAN }]);
});

test("double appui sur Confirmer : un seul envoi", async ({ page }) => {
  const etat = etatInitial({
    repondreEnvoi: async (route, corps) => {
      await new Promise((r) => setTimeout(r, 400));
      await json(route, { resultats: corps.destinataires.map((d) => resultat(d.locataireId, "envoye")) });
    }
  });
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);
  await page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true }).click();

  await page.getByRole("button", { name: "Confirmer l'envoi" }).evaluate((bouton: HTMLButtonElement) => {
    bouton.click();
    bouton.click();
  });

  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(2);
  expect(etat.appelsEnvoi).toHaveLength(1);
});

test("adresse manquante : refusée si invalide, enregistrée dans la fiche, destinataire coché, puis envoi", async ({ page }) => {
  const etat = etatInitial();
  etat.destinataires[1]!.email = null;
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  const champ = page.getByLabel("Adresse e-mail de Alex Martin");
  await champ.fill("alex@a.fr,b@b.fr");
  await page.getByRole("button", { name: "Enregistrer dans la fiche" }).click();
  await expect(page.getByText("Adresse e-mail invalide.")).toBeVisible();
  expect(etat.appelsPatch).toHaveLength(0);

  await champ.fill(EMAIL_ALEX);
  await page.getByRole("button", { name: "Enregistrer dans la fiche" }).click();

  await expect(page.getByText(EMAIL_ALEX)).toBeVisible();
  expect(etat.appelsPatch).toEqual([{ url: `/locataires/${ALEX}`, corps: { email: EMAIL_ALEX } }]);
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await expect(page.getByRole("checkbox").nth(1)).toBeChecked();

  await confirmer(page);

  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(2);
});

test("adresse mal formée en fiche : proposée à la correction, jamais envoyée telle quelle", async ({ page }) => {
  const etat = etatInitial();
  etat.destinataires[1]!.email = "alex@a.fr,b@b.fr";
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  const champ = page.getByLabel("Adresse e-mail de Alex Martin");
  await expect(champ).toHaveValue("alex@a.fr,b@b.fr");
  await expect(page.getByRole("checkbox")).toHaveCount(1);

  await champ.fill(EMAIL_ALEX);
  await page.getByRole("button", { name: "Enregistrer dans la fiche" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(2);

  await confirmer(page);

  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(2);
  expect(etat.appelsEnvoi[0]?.destinataires).toContainEqual({ locataireId: ALEX, email: EMAIL_ALEX });
});

test("modifier une adresse valide : confirmation avant d'écrire la fiche, puis envoi à la nouvelle adresse", async ({ page }) => {
  const etat = etatInitial();
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);
  const NOUVELLE = "jean.nouveau@example.com";

  await page.getByRole("button", { name: "Modifier l'adresse de Jean Dupont" }).click();
  const champ = page.getByLabel("Adresse e-mail de Jean Dupont");
  await expect(champ).toHaveValue(EMAIL_JEAN);

  await champ.fill(NOUVELLE);
  await page.getByRole("button", { name: "Enregistrer dans la fiche" }).click();
  await expect(page.getByText(`Remplacer ${EMAIL_JEAN} par ${NOUVELLE} dans la fiche de Jean Dupont ?`)).toBeVisible();
  expect(etat.appelsPatch).toHaveLength(0);

  await page.getByRole("button", { name: "Annuler" }).click();
  expect(etat.appelsPatch).toHaveLength(0);
  await expect(champ).toHaveValue(NOUVELLE);

  await page.getByRole("button", { name: "Enregistrer dans la fiche" }).click();
  await page.getByRole("button", { name: "Confirmer la modification" }).click();

  await expect(page.getByText(NOUVELLE)).toBeVisible();
  await expect(page.getByText(EMAIL_JEAN)).toHaveCount(0);
  expect(etat.appelsPatch).toEqual([{ url: `/locataires/${JEAN}`, corps: { email: NOUVELLE } }]);

  await confirmer(page);

  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(2);
  expect(etat.appelsEnvoi[0]?.destinataires).toContainEqual({ locataireId: JEAN, email: NOUVELLE });
});

test("modifier une adresse : refus si invalide, Annuler restaure, adresse inchangée sans écriture", async ({ page }) => {
  const etat = etatInitial();
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await page.getByRole("button", { name: "Modifier l'adresse de Jean Dupont" }).click();
  await page.getByLabel("Adresse e-mail de Jean Dupont").fill("jean@a.fr;b@b.fr");
  await page.getByRole("button", { name: "Enregistrer dans la fiche" }).click();
  await expect(page.getByText("Adresse e-mail invalide.")).toBeVisible();

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText(EMAIL_JEAN)).toBeVisible();

  await page.getByRole("button", { name: "Modifier l'adresse de Jean Dupont" }).click();
  await page.getByRole("button", { name: "Enregistrer dans la fiche" }).click();

  await expect(page.getByText(EMAIL_JEAN)).toBeVisible();
  await expect(page.getByLabel("Adresse e-mail de Jean Dupont")).toHaveCount(0);
  expect(etat.appelsPatch).toHaveLength(0);
});

test("modifier une adresse déjà utilisée : le destinataire est recoché pour un renvoi", async ({ page }) => {
  const etat = etatInitial();
  etat.destinataires[0]!.dernierEnvoi = resultat(JEAN, "envoye");
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);
  await expect(page.getByRole("checkbox").nth(0)).not.toBeChecked();

  await page.getByRole("button", { name: "Modifier l'adresse de Jean Dupont" }).click();
  await page.getByLabel("Adresse e-mail de Jean Dupont").fill("jean.nouveau@example.com");
  await page.getByRole("button", { name: "Enregistrer dans la fiche" }).click();
  await page.getByRole("button", { name: "Confirmer la modification" }).click();

  await expect(page.getByRole("checkbox").nth(0)).toBeChecked();
});

test("adresse saisie mais non enregistrée : envoi bloqué avec message, débloqué après enregistrement", async ({ page }) => {
  const etat = etatInitial();
  etat.destinataires[1]!.email = null;
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);
  const envoyer = page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true });
  await expect(envoyer).toBeEnabled();

  await page.getByLabel("Adresse e-mail de Alex Martin").fill(EMAIL_ALEX);

  await expect(envoyer).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Adresse saisie mais non enregistrée pour Alex Martin");
  expect(etat.appelsEnvoi).toHaveLength(0);

  await page.getByRole("button", { name: "Enregistrer dans la fiche" }).click();

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(envoyer).toBeEnabled();
  await confirmer(page);
  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(2);
  expect(etat.appelsEnvoi[0]?.destinataires).toHaveLength(2);
});

test("adresse saisie puis vidée : l'envoi redevient possible, et le signataire exclu est annoncé", async ({ page }) => {
  const etat = etatInitial();
  etat.destinataires[1]!.email = null;
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);
  const champ = page.getByLabel("Adresse e-mail de Alex Martin");
  const envoyer = page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true });

  await champ.fill("alex");
  await expect(envoyer).toBeDisabled();
  await champ.fill("");
  await expect(envoyer).toBeEnabled();

  await envoyer.click();

  await expect(page.getByText("Alex Martin : non destinataire")).toBeVisible();
  await expect(page.getByText(/Jean Dupont\s+—/)).toBeVisible();
});

test("modification d'adresse en attente : envoi bloqué, Annuler le débloque", async ({ page }) => {
  const etat = etatInitial();
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);
  const envoyer = page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true });

  await page.getByRole("button", { name: "Modifier l'adresse de Jean Dupont" }).click();
  await expect(envoyer).toBeEnabled();
  await page.getByLabel("Adresse e-mail de Jean Dupont").fill("jean.nouveau@example.com");
  await expect(envoyer).toBeDisabled();

  await page.getByRole("button", { name: "Annuler" }).click();

  await expect(envoyer).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("confirmation : un signataire décoché est annoncé comme non destinataire", async ({ page }) => {
  const etat = etatInitial();
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await page.getByRole("checkbox").nth(1).uncheck();
  await page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true }).click();

  await expect(page.getByText("Alex Martin : non destinataire")).toBeVisible();
  await expect(page.getByText("Jean Dupont : non destinataire")).toHaveCount(0);
});

test("confirmation : tous destinataires, aucune mention de non destinataire", async ({ page }) => {
  const etat = etatInitial();
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true }).click();

  await expect(page.getByRole("button", { name: "Confirmer l'envoi" })).toBeVisible();
  await expect(page.getByText(/non destinataire/)).toHaveCount(0);
});

test("renvoi : le signataire déjà servi est annoncé avec sa date", async ({ page }) => {
  const etat = etatInitial();
  etat.repondreEnvoi = (route) => {
    etat.destinataires[1]!.dernierEnvoi = resultat(ALEX, "envoye");
    return json(route, {
      resultats: [resultat(JEAN, "echec", { codeErreur: "SMTP_RESEAU", messageErreur: "Injoignable." }), resultat(ALEX, "envoye")]
    });
  };
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);
  await confirmer(page);
  await expect(page.getByText("Injoignable.")).toBeVisible();

  await page.getByRole("button", { name: "Renvoyer aux destinataires restants" }).click();

  await expect(page.getByText(/Alex Martin : non destinataire \(déjà envoyé le 3 novembre 2026/)).toBeVisible();
});

test("sans aucune adresse, le bouton d'envoi reste inactif", async ({ page }) => {
  const etat = etatInitial();
  for (const d of etat.destinataires) {
    d.email = null;
  }
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await expect(page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true })).toBeDisabled();
});

test("demande interrompue : destinataire sans résultat signalé, nouvel envoi avec une nouvelle demande pour lui seul", async ({ page }) => {
  let reponses = 0;
  const etat = etatInitial({
    repondreEnvoi: async (route, corps) => {
      reponses++;
      const resultats = reponses === 1 ? [resultat(JEAN, "envoye")] : corps.destinataires.map((d) => resultat(d.locataireId, "envoye"));
      await json(route, { resultats });
    }
  });
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await confirmer(page);

  await expect(page.getByText(/Aucun résultat : l'envoi a été interrompu/)).toBeVisible();
  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(1);

  await page.getByRole("button", { name: "Renvoyer aux destinataires restants" }).click();
  await expect(page.getByText(/Alex Martin\s+—/)).toBeVisible();
  await expect(page.getByText(/Jean Dupont\s+—/)).toHaveCount(0);
  await page.getByRole("button", { name: "Confirmer l'envoi" }).click();

  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(1);
  expect(etat.appelsEnvoi).toHaveLength(2);
  expect(etat.appelsEnvoi[1]?.destinataires).toEqual([{ locataireId: ALEX, email: EMAIL_ALEX }]);
  expect(etat.appelsEnvoi[1]?.demandeId).not.toBe(etat.appelsEnvoi[0]?.demandeId);
});

test("réponse perdue : Réessayer rejoue la même demande", async ({ page }) => {
  let reponses = 0;
  const etat = etatInitial({
    repondreEnvoi: async (route, corps) => {
      reponses++;
      if (reponses === 1) {
        await route.abort("connectionreset");
        return;
      }
      await json(route, { resultats: corps.destinataires.map((d) => resultat(d.locataireId, "envoye")) });
    }
  });
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await confirmer(page);

  await expect(page.getByRole("alert")).toContainText("il ne sera pas envoyé deux fois");
  await page.getByRole("button", { name: "Réessayer" }).click();

  await expect(page.getByText(/Accepté par le serveur d'envoi/)).toHaveCount(2);
  expect(etat.appelsEnvoi).toHaveLength(2);
  expect(etat.appelsEnvoi[1]?.demandeId).toBe(etat.appelsEnvoi[0]?.demandeId);
});

test("refus du serveur : message affiché, retour à la liste, aucune reprise de la demande", async ({ page }) => {
  const etat = etatInitial({
    repondreEnvoi: (route) => json(route, { message: "L'adresse de Jean Dupont a changé. Vérifiez-la avant d'envoyer." }, 409)
  });
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await confirmer(page);

  await expect(page.getByRole("alert")).toHaveText("L'adresse de Jean Dupont a changé. Vérifiez-la avant d'envoyer.");
  await expect(page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réessayer" })).toHaveCount(0);
});

test("échec d'un destinataire : message affiché, renvoi limité à lui", async ({ page }) => {
  const etat = etatInitial({
    repondreEnvoi: (route) =>
      json(route, {
        resultats: [
          resultat(JEAN, "echec", { codeErreur: "SMTP_RESEAU", messageErreur: "Le serveur de messagerie est injoignable." }),
          resultat(ALEX, "envoye")
        ]
      })
  });
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  await confirmer(page);

  await expect(page.getByText("Le serveur de messagerie est injoignable.")).toBeVisible();
  await page.getByRole("button", { name: "Renvoyer aux destinataires restants" }).click();
  await expect(page.getByText(/Jean Dupont\s+—/)).toBeVisible();
  await expect(page.getByText(/Alex Martin\s+—/)).toHaveCount(0);
});

test("déjà envoyé : non coché d'office, recochable, avertissement à la confirmation", async ({ page }) => {
  const etat = etatInitial();
  etat.destinataires[0]!.dernierEnvoi = resultat(JEAN, "envoye");
  await simulerBackend(page, etat);
  await ouvrirPanneauEntree(page);

  const caseJean = page.getByRole("checkbox").nth(0);
  await expect(caseJean).not.toBeChecked();
  await caseJean.check();
  await page.getByRole("button", { name: "Envoyer l'état des lieux", exact: true }).click();

  await expect(page.getByText(/Déjà envoyé le 3 novembre 2026/)).toBeVisible();
});

test("PDF jamais prêt : Réessayer après le plafond relance la production", async ({ page }) => {
  await page.clock.install();
  const etat = etatInitial({ pdfPretApres: 1_000 });
  await simulerBackend(page, etat);
  await page.goto("/test-harness/remise.html");
  await page.getByRole("button", { name: "Envoyer l'état des lieux d'entrée" }).click();
  await expect(page.getByText("PDF en préparation")).toBeVisible();

  for (let i = 0; i < 45; i++) {
    await page.clock.runFor(3_000);
    if (await page.getByText("Le PDF n'est pas encore prêt.", { exact: false }).isVisible()) {
      break;
    }
  }
  await expect(page.getByText(/Le PDF n'est pas encore prêt/)).toBeVisible();

  await page.getByRole("button", { name: "Réessayer" }).click();

  await expect(page.getByText("PDF prêt.")).toBeVisible();
  expect(etat.appelsProductionPdf).toBe(1);
});

test("signature acquise mais rechargement en panne : le panneau s'ouvre, jamais une nouvelle signature", async ({ page }) => {
  const etat = etatInitial();
  await simulerBackend(page, etat);
  await allerALaSignature(page);
  await signer(page);
  etat.rechargementEnPanne = true;

  await page.getByRole("button", { name: "Terminer" }).click();

  await expect(page.getByText("Remise de l'état des lieux de sortie")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(etat.appelsSignature).toBe(1);
});

test("réponse de signature perdue : la signature est reconnue au rechargement, sans nouvel appui", async ({ page }) => {
  const etat = etatInitial();
  etat.repondreSignature = async (route) => {
    etat.sortieSignee = true;
    etat.statut = "complet";
    await route.abort("connectionreset");
  };
  await simulerBackend(page, etat);
  await allerALaSignature(page);
  await signer(page);

  await page.getByRole("button", { name: "Terminer" }).click();

  await expect(page.getByText("Remise de l'état des lieux de sortie")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(etat.appelsSignature).toBe(1);
});

test("réponse perdue et réseau encore en panne : Réessayer reçoit un 409, la signature est reconnue", async ({ page }) => {
  const etat = etatInitial();
  etat.repondreSignature = async (route) => {
    if (etat.appelsSignature === 1) {
      etat.rechargementEnPanne = true;
      await route.abort("connectionreset");
      return;
    }
    await json(route, { message: "Cet état des lieux est déjà intégralement signé." }, 409);
  };
  await simulerBackend(page, etat);
  await allerALaSignature(page);
  await signer(page);

  await page.getByRole("button", { name: "Terminer" }).click();
  await expect(page.getByRole("alert")).toContainText("vérifiez votre connexion");

  etat.rechargementEnPanne = false;
  etat.sortieSignee = true;
  etat.statut = "complet";
  await page.getByRole("button", { name: "Réessayer" }).click();

  await expect(page.getByText("Remise de l'état des lieux de sortie")).toBeVisible();
  expect(etat.appelsSignature).toBe(2);
});

test("pièce ajoutée après l'entrée : message en clair, mais l'étape ne permet pas d'avancer", async ({ page }) => {
  const MESSAGE = "Cette pièce a été ajoutée après l'état des lieux d'entrée : ses informations ne peuvent pas être modifiées ici.";
  await simulerBackend(page, etatInitial({ autrePiece1: "Cellier", refusPieceAutre: MESSAGE }));
  await page.goto("/test-harness/remise.html");
  const bouton = page.getByRole("button", { name: "Suivant" });
  for (const titre of [/Entrée 1\//, /Séjour 2\//, /Cuisine 3\//]) {
    await expect(page.getByText(titre)).toBeVisible();
    await bouton.click();
  }
  await expect(page.getByText(/Cellier 4\//)).toBeVisible();

  await bouton.click();

  await expect(page.getByRole("alert")).toHaveText(MESSAGE);
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await expect(page.getByText(/Cellier 4\//)).toBeVisible();
});

test("signature refusée pour de vrai : l'erreur reste affichée, pas de panneau", async ({ page }) => {
  const etat = etatInitial({
    repondreSignature: (route) => json(route, { message: "La nouvelle adresse du locataire est obligatoire pour signer la sortie." }, 400)
  });
  await simulerBackend(page, etat);
  await allerALaSignature(page);
  await signer(page);

  await page.getByRole("button", { name: "Terminer" }).click();

  await expect(page.getByRole("alert")).toContainText("obligatoire pour signer la sortie");
  await expect(page.getByText("Remise de l'état des lieux de sortie")).toHaveCount(0);
});
