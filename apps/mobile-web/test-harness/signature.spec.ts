import type { CDPSession, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Vérifie SignatureStepScreen dans un vrai navigateur (Chromium, viewport
// téléphone — voir playwright.config.ts, devices["iPhone 13"]) : jsdom ne
// sait pas piloter un <canvas> au doigt (signature_pad), ni distinguer un
// tracé avant/après activation de la zone. page.touchscreen (API publique
// Playwright) ne propose qu'un tap ponctuel, pas de glissé multi-points —
// un vrai tracé de signature nécessite donc Input.dispatchTouchEvent (CDP)
// directement, seule façon de simuler un doigt qui glisse sur l'écran.
async function tracerAuDoigt(client: CDPSession, points: { x: number; y: number }[]): Promise<void> {
  const [premier, ...reste] = points;
  if (!premier) {
    return;
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: premier.x, y: premier.y }]
  });
  for (const p of reste) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x, y: p.y }] });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

function trajetDiagonal(boite: { x: number; y: number; width: number; height: number }) {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 10; i++) {
    points.push({
      x: boite.x + (boite.width * i) / 10,
      y: boite.y + boite.height * 0.3 + boite.height * 0.4 * Math.sin(i)
    });
  }
  return points;
}

// Les champs placés avant les cartes font défiler l'écran : la position d'une
// zone se relit juste avant chaque tracé.
async function tracerSur(client: CDPSession, canvas: Locator): Promise<void> {
  await canvas.scrollIntoViewIfNeeded();
  const boite = await canvas.boundingBox();
  if (!boite) {
    throw new Error("Zone de signature introuvable");
  }
  await tracerAuDoigt(client, trajetDiagonal(boite));
}

async function mockSignataires(page: Page, nouvelleAdresseLocataire: string | null = null): Promise<void> {
  await page.route("**/etats-des-lieux/edl-test-harnais/signataires", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        villeLogement: "Lyon",
        bailleurNomPropose: "Jimmy Ettori",
        nouvelleAdresseLocataire,
        locataires: [{ locataireId: "loc-1", nomAffiche: "Jean Dupont" }],
        entreeSignee: false,
        sortieSignee: false
      })
    });
  });
}

test("écran de signature : zone inactive avant la case cochée, tracé tactile réel, Effacer, et Terminer après complétion", async ({
  page
}) => {
  await mockSignataires(page);
  const client = await page.context().newCDPSession(page);

  await page.goto("/test-harness/signature.html");

  // Largeur téléphone effective (vérifie que le viewport du device
  // Playwright est bien appliqué, pas un défaut desktop oublié).
  const taille = page.viewportSize();
  expect(taille?.width).toBeLessThanOrEqual(430);

  await expect(page.getByPlaceholder("Nom du bailleur")).toHaveValue("Jimmy Ettori");
  await expect(page.getByText("Jean Dupont")).toBeVisible();
  await expect(page.getByTestId("pret")).toHaveText("non-pret");

  const canvasBailleur = page.getByRole("img", { name: "Zone de signature" }).first();
  const canvasLocataire = page.getByRole("img", { name: "Zone de signature" }).nth(1);
  const checkboxes = page.getByRole("checkbox");
  const effacerBoutons = page.getByRole("button", { name: "Effacer" });

  // 1) Tracé tenté AVANT de cocher « Lu et approuvé » : doit être ignoré
  // (touch-action: none + SignaturePad.off()). Preuve ISOLÉE (pas de
  // redessin avant l'assertion) : on coche ensuite le bailleur SANS
  // redessiner, on complète entièrement le locataire, et on vérifie que
  // l'ensemble reste "non-pret" — si le tracé pré-coche avait été capté
  // à tort, les 2 cartes seraient complètes à ce stade et "pret" serait
  // (faussement) vrai.
  await tracerSur(client, canvasBailleur);
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await tracerSur(client, canvasLocataire);
  await expect(page.getByTestId("pret")).toHaveText("non-pret");

  // 2) Tracé réel une fois la case du bailleur cochée (zone active) :
  // doit être pris en compte, et l'ensemble devient prêt (locataire déjà
  // complet depuis l'étape précédente).
  await tracerSur(client, canvasBailleur);
  await expect(page.getByTestId("pret")).toHaveText("pret");

  // 3) Effacer la signature du bailleur : repasse en non prêt même si la
  // case reste cochée (le dessin est requis, pas seulement la case).
  await effacerBoutons.nth(0).click();
  await expect(page.getByTestId("pret")).toHaveText("non-pret");

  // 4) Redessine le bailleur : à nouveau prêt.
  await tracerSur(client, canvasBailleur);
  await expect(page.getByTestId("pret")).toHaveText("pret");

  // 5) « Terminer » : un seul appel, données exactes (nom, case cochée,
  // image non vide pour les 2 signataires).
  await page.getByTestId("terminer").click();
  await expect(page.getByTestId("statut-envoi")).toHaveText("ok");
  const envoye = JSON.parse((await page.getByTestId("dernier-envoi").textContent()) ?? "{}");
  expect(envoye.bailleurNom).toBe("Jimmy Ettori");
  expect(envoye.bailleurLu).toBe(true);
  expect(envoye.bailleurImageLongueur).toBeGreaterThan(0);
  expect(envoye.lieu).toBe("Lyon");
  expect(envoye.locataires).toEqual([{ id: "loc-1", lu: true, imgLen: expect.any(Number) }]);
  expect(envoye.locataires[0].imgLen).toBeGreaterThan(0);
});

async function signerLesDeuxCartes(page: Page, client: CDPSession): Promise<void> {
  const cases = page.getByRole("checkbox");
  await cases.nth(0).check();
  await cases.nth(1).check();
  for (const rang of [0, 1]) {
    await tracerSur(client, page.getByRole("img", { name: "Zone de signature" }).nth(rang));
  }
}

async function deverrouiller(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Modifier les textes" }).click();
  await page.getByRole("button", { name: "Effacer les signatures" }).click();
}

test("entrée : aucun champ de nouvelle adresse, jamais envoyée", async ({ page }) => {
  await mockSignataires(page, "Valeur inattendue");
  const client = await page.context().newCDPSession(page);
  await page.goto("/test-harness/signature.html");

  await expect(page.getByPlaceholder("Nom du bailleur")).toBeVisible();
  await expect(page.getByLabel("Nouvelle adresse du locataire")).toHaveCount(0);

  await signerLesDeuxCartes(page, client);
  await expect(page.getByTestId("pret")).toHaveText("pret");
  await page.getByTestId("terminer").click();
  await expect(page.getByTestId("statut-envoi")).toHaveText("ok");
  const envoye = JSON.parse((await page.getByTestId("dernier-envoi").textContent()) ?? "{}");
  expect(envoye.nouvelleAdresseLocataire).toBeUndefined();
});

test("sortie : signature impossible sans adresse, champ visible avant les signatures, valeur nettoyée à l'envoi", async ({
  page
}) => {
  await mockSignataires(page);
  const client = await page.context().newCDPSession(page);
  await page.goto("/test-harness/signature.html?mode=sortie");

  const champ = page.getByLabel("Nouvelle adresse du locataire");
  await expect(champ).toHaveValue("");

  const boiteChamp = await champ.boundingBox();
  const boiteSignature = await page.getByRole("img", { name: "Zone de signature" }).first().boundingBox();
  if (!boiteChamp || !boiteSignature) {
    throw new Error("Champ ou zone de signature introuvable");
  }
  expect(boiteChamp.y).toBeLessThan(boiteSignature.y);

  await signerLesDeuxCartes(page, client);
  await expect(page.getByTestId("pret")).toHaveText("non-pret");
  await expect(page.getByRole("alert")).toContainText("Nouvelle adresse manquante");

  await deverrouiller(page);
  await champ.fill("   ");
  await signerLesDeuxCartes(page, client);
  await expect(page.getByTestId("pret")).toHaveText("non-pret");

  await deverrouiller(page);
  await champ.fill("  Non communiquée par le locataire  ");
  await signerLesDeuxCartes(page, client);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("pret")).toHaveText("pret");

  await page.getByTestId("terminer").click();
  await expect(page.getByTestId("statut-envoi")).toHaveText("ok");
  const envoye = JSON.parse((await page.getByTestId("dernier-envoi").textContent()) ?? "{}");
  expect(envoye.nouvelleAdresseLocataire).toBe("Non communiquée par le locataire");
});

test("sortie : l'adresse déjà enregistrée est proposée, l'effacer bloque la signature", async ({ page }) => {
  await mockSignataires(page, "12 rue du Départ, 69001 Lyon");
  const client = await page.context().newCDPSession(page);
  await page.goto("/test-harness/signature.html?mode=sortie");

  const champ = page.getByLabel("Nouvelle adresse du locataire");
  await expect(champ).toHaveValue("12 rue du Départ, 69001 Lyon");

  await signerLesDeuxCartes(page, client);
  await expect(page.getByTestId("pret")).toHaveText("pret");

  await deverrouiller(page);
  await champ.fill("");
  await signerLesDeuxCartes(page, client);
  await expect(page.getByTestId("pret")).toHaveText("non-pret");
});

test("sortie : plusieurs lignes acceptées, longueur plafonnée", async ({ page }) => {
  await mockSignataires(page);
  await page.goto("/test-harness/signature.html?mode=sortie");

  const champ = page.getByLabel("Nouvelle adresse du locataire");
  await champ.fill("Jean Dupont : 1 rue A\nAlex Martin : 2 rue B");
  await expect(champ).toHaveValue("Jean Dupont : 1 rue A\nAlex Martin : 2 rue B");
  await expect(champ).toHaveAttribute("maxlength", "500");
});

test("le lieu proposé (ville du logement) reste modifiable", async ({ page }) => {
  await mockSignataires(page);
  await page.goto("/test-harness/signature.html");
  const champLieu = page.getByPlaceholder("Ville");
  await expect(champLieu).toHaveValue("Lyon");
  await champLieu.fill("Marseille");
  await expect(champLieu).toHaveValue("Marseille");
});

test("le nom du bailleur reste modifiable, celui du locataire ne l'est pas", async ({ page }) => {
  await mockSignataires(page);
  await page.goto("/test-harness/signature.html");
  const champNomBailleur = page.getByPlaceholder("Nom du bailleur");
  await expect(champNomBailleur).toHaveValue("Jimmy Ettori");
  await champNomBailleur.fill("Mandataire Dupont");
  await expect(champNomBailleur).toHaveValue("Mandataire Dupont");
  // Le nom du locataire est un texte statique, jamais un champ.
  await expect(page.getByPlaceholder(/Jean Dupont/)).toHaveCount(0);
  await expect(page.getByText("Jean Dupont")).toBeVisible();
});

for (const [mode, url, cleObservations, cleReserves, autresCles] of [
  ["entrée", "/test-harness/signature.html", "observationsBailleurEntree", "reservesLocataireEntree", ["observationsBailleurSortie", "reservesLocataireSortie"]],
  ["sortie", "/test-harness/signature.html?mode=sortie", "observationsBailleurSortie", "reservesLocataireSortie", ["observationsBailleurEntree", "reservesLocataireEntree"]]
] as const) {
  test(`${mode} : observations et réserves saisies avant les tracés, nettoyées, envoyées pour cette phase seulement`, async ({ page }) => {
    await mockSignataires(page, "12 rue du Départ, 69001 Lyon");
    const client = await page.context().newCDPSession(page);
    await page.goto(url);

    const observations = page.getByLabel("Observations du bailleur (facultatif)");
    const reserves = page.getByLabel("Réserves du locataire (facultatif)");
    await expect(observations).toHaveAttribute("maxlength", "2000");
    await expect(reserves).toHaveAttribute("maxlength", "2000");

    const boiteReserves = await reserves.boundingBox();
    const boiteSignature = await page.getByRole("img", { name: "Zone de signature" }).first().boundingBox();
    if (!boiteReserves || !boiteSignature) {
      throw new Error("Champ ou zone de signature introuvable");
    }
    expect(boiteReserves.y).toBeLessThan(boiteSignature.y);

    await observations.fill("  Peinture à reprendre\nVolet lent  ");
    await reserves.fill("  Rayure sur le parquet  ");
    await signerLesDeuxCartes(page, client);
    await expect(page.getByTestId("pret")).toHaveText("pret");
    await page.getByTestId("terminer").click();
    await expect(page.getByTestId("statut-envoi")).toHaveText("ok");

    const envoye = JSON.parse((await page.getByTestId("dernier-envoi").textContent()) ?? "{}");
    expect(envoye[cleObservations]).toBe("Peinture à reprendre\nVolet lent");
    expect(envoye[cleReserves]).toBe("Rayure sur le parquet");
    for (const cle of autresCles) {
      expect(envoye[cle]).toBeUndefined();
    }
  });
}

test("observations et réserves facultatives : laissées vides ou blanches, rien n'est envoyé", async ({ page }) => {
  await mockSignataires(page);
  const client = await page.context().newCDPSession(page);
  await page.goto("/test-harness/signature.html");

  await page.getByLabel("Réserves du locataire (facultatif)").fill("   ");
  await signerLesDeuxCartes(page, client);
  await expect(page.getByTestId("pret")).toHaveText("pret");
  await page.getByTestId("terminer").click();
  await expect(page.getByTestId("statut-envoi")).toHaveText("ok");

  const envoye = JSON.parse((await page.getByTestId("dernier-envoi").textContent()) ?? "{}");
  expect(envoye.observationsBailleurEntree).toBeUndefined();
  expect(envoye.reservesLocataireEntree).toBeUndefined();
});

function textes(page: Page) {
  return [
    page.getByPlaceholder("Ville"),
    page.getByPlaceholder("Nom du bailleur"),
    page.getByLabel("Nouvelle adresse du locataire"),
    page.getByLabel("Observations du bailleur (facultatif)"),
    page.getByLabel("Réserves du locataire (facultatif)")
  ];
}

async function attendreTextesVerrouilles(page: Page): Promise<void> {
  for (const champ of textes(page)) {
    await expect(champ).not.toBeEditable();
  }
  await expect(page.getByRole("button", { name: "Modifier les textes" })).toBeVisible();
}

async function attendreTextesModifiables(page: Page): Promise<void> {
  for (const champ of textes(page)) {
    await expect(champ).toBeEditable();
  }
  await expect(page.getByRole("button", { name: "Modifier les textes" })).toHaveCount(0);
}

test("verrouillage : une seule case cochée fige tous les textes, la décocher sans tracé les libère", async ({ page }) => {
  await mockSignataires(page, "12 rue du Départ, 69001 Lyon");
  await page.goto("/test-harness/signature.html?mode=sortie");
  await attendreTextesModifiables(page);

  // Case d'un locataire, pas celle du bailleur : n'importe quel signataire verrouille.
  const caseLocataire = page.getByRole("checkbox").nth(1);
  await caseLocataire.check();
  await attendreTextesVerrouilles(page);

  await caseLocataire.uncheck();
  await attendreTextesModifiables(page);
});

test("verrouillage : un tracé existant fige les textes même sa case décochée", async ({ page }) => {
  await mockSignataires(page, "12 rue du Départ, 69001 Lyon");
  const client = await page.context().newCDPSession(page);
  await page.goto("/test-harness/signature.html?mode=sortie");

  const caseBailleur = page.getByRole("checkbox").first();
  await caseBailleur.check();
  await tracerSur(client, page.getByRole("img", { name: "Zone de signature" }).first());
  await caseBailleur.uncheck();

  await attendreTextesVerrouilles(page);

  // Effacer le tracé avec son bouton de carte : plus rien à couvrir.
  await caseBailleur.check();
  await page.getByRole("button", { name: "Effacer", exact: true }).first().click();
  await caseBailleur.uncheck();
  await attendreTextesModifiables(page);
});

test("déverrouillage : confirmation exigée, Annuler ne touche à rien, confirmer efface tous les tracés et toutes les cases", async ({ page }) => {
  await mockSignataires(page, "12 rue du Départ, 69001 Lyon");
  const client = await page.context().newCDPSession(page);
  await page.goto("/test-harness/signature.html?mode=sortie");

  await signerLesDeuxCartes(page, client);
  await expect(page.getByTestId("pret")).toHaveText("pret");

  await page.getByRole("button", { name: "Modifier les textes" }).click();
  await expect(page.getByText("Toutes les signatures déjà faites seront effacées et devront être refaites")).toBeVisible();
  for (const champ of textes(page)) {
    await expect(champ).not.toBeEditable();
  }

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Toutes les signatures déjà faites seront effacées")).toHaveCount(0);
  await expect(page.getByTestId("pret")).toHaveText("pret");
  await attendreTextesVerrouilles(page);

  await deverrouiller(page);
  await attendreTextesModifiables(page);
  await expect(page.getByTestId("pret")).toHaveText("non-pret");
  const cases = page.getByRole("checkbox");
  await expect(cases.nth(0)).not.toBeChecked();
  await expect(cases.nth(1)).not.toBeChecked();

  // Preuve que les tracés sont partis, pas seulement les cases : recocher sans
  // retracer ne redonne pas une signature complète.
  await cases.nth(0).check();
  await cases.nth(1).check();
  await expect(page.getByTestId("pret")).toHaveText("non-pret");
});

test("envoi : après modification, seul le texte final part, avec les nouvelles signatures", async ({ page }) => {
  await mockSignataires(page, "12 rue du Départ, 69001 Lyon");
  const client = await page.context().newCDPSession(page);
  await page.goto("/test-harness/signature.html?mode=sortie");

  await page.getByLabel("Observations du bailleur (facultatif)").fill("Premier texte");
  await page.getByLabel("Réserves du locataire (facultatif)").fill("Première réserve");
  await signerLesDeuxCartes(page, client);

  await deverrouiller(page);
  await page.getByPlaceholder("Ville").fill("Marseille");
  await page.getByPlaceholder("Nom du bailleur").fill("Mandataire Dupont");
  await page.getByLabel("Nouvelle adresse du locataire").fill("3 rue Neuve, 69001 Lyon");
  await page.getByLabel("Observations du bailleur (facultatif)").fill("Texte final");
  await page.getByLabel("Réserves du locataire (facultatif)").fill("");

  await signerLesDeuxCartes(page, client);
  await expect(page.getByTestId("pret")).toHaveText("pret");
  await page.getByTestId("terminer").click();
  await expect(page.getByTestId("statut-envoi")).toHaveText("ok");

  const envoye = JSON.parse((await page.getByTestId("dernier-envoi").textContent()) ?? "{}");
  expect(envoye.lieu).toBe("Marseille");
  expect(envoye.bailleurNom).toBe("Mandataire Dupont");
  expect(envoye.nouvelleAdresseLocataire).toBe("3 rue Neuve, 69001 Lyon");
  expect(envoye.observationsBailleurSortie).toBe("Texte final");
  expect(envoye.reservesLocataireSortie).toBeUndefined();
  expect(envoye.bailleurImageLongueur).toBeGreaterThan(0);
  expect(envoye.locataires[0].imgLen).toBeGreaterThan(0);
});

// Filet générique : ne cite aucun champ par son nom. Un champ ajouté plus tard
// à l'écran de signature sans le verrou fait échouer ce test.
for (const [mode, url, attendus] of [
  ["entrée", "/test-harness/signature.html", 4],
  ["sortie", "/test-harness/signature.html?mode=sortie", 5]
] as const) {
  test(`${mode} : une case cochée, aucun champ de saisie ne reste modifiable sur l'écran`, async ({ page }) => {
    await mockSignataires(page, "12 rue du Départ, 69001 Lyon");
    await page.goto(url);

    const champs = page.locator('input:not([type="checkbox"]), textarea');
    await expect(page.getByPlaceholder("Nom du bailleur")).toBeVisible();
    await expect(champs).toHaveCount(attendus);
    for (let rang = 0; rang < attendus; rang++) {
      await expect(champs.nth(rang)).toBeEditable();
    }

    await page.getByRole("checkbox").last().check();

    for (let rang = 0; rang < attendus; rang++) {
      await expect(champs.nth(rang)).not.toBeEditable();
    }
  });
}
