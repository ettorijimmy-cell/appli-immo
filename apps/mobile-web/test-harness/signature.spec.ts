import { expect, test, type CDPSession, type Page } from "@playwright/test";

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

async function mockSignataires(page: Page): Promise<void> {
  await page.route("**/etats-des-lieux/edl-test-harnais/signataires", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        villeLogement: "Lyon",
        bailleurNomPropose: "Jimmy Ettori",
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
  const boiteBailleur = await canvasBailleur.boundingBox();
  if (!boiteBailleur) {
    throw new Error("Zone de signature du bailleur introuvable");
  }

  const canvasLocataire = page.getByRole("img", { name: "Zone de signature" }).nth(1);
  const boiteLocataire = await canvasLocataire.boundingBox();
  if (!boiteLocataire) {
    throw new Error("Zone de signature du locataire introuvable");
  }
  const checkboxes = page.getByRole("checkbox");
  const effacerBoutons = page.getByRole("button", { name: "Effacer" });

  // 1) Tracé tenté AVANT de cocher « Lu et approuvé » : doit être ignoré
  // (touch-action: none + SignaturePad.off()). Preuve ISOLÉE (pas de
  // redessin avant l'assertion) : on coche ensuite le bailleur SANS
  // redessiner, on complète entièrement le locataire, et on vérifie que
  // l'ensemble reste "non-pret" — si le tracé pré-coche avait été capté
  // à tort, les 2 cartes seraient complètes à ce stade et "pret" serait
  // (faussement) vrai.
  await tracerAuDoigt(client, trajetDiagonal(boiteBailleur));
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await tracerAuDoigt(client, trajetDiagonal(boiteLocataire));
  await expect(page.getByTestId("pret")).toHaveText("non-pret");

  // 2) Tracé réel une fois la case du bailleur cochée (zone active) :
  // doit être pris en compte, et l'ensemble devient prêt (locataire déjà
  // complet depuis l'étape précédente).
  await tracerAuDoigt(client, trajetDiagonal(boiteBailleur));
  await expect(page.getByTestId("pret")).toHaveText("pret");

  // 3) Effacer la signature du bailleur : repasse en non prêt même si la
  // case reste cochée (le dessin est requis, pas seulement la case).
  await effacerBoutons.nth(0).click();
  await expect(page.getByTestId("pret")).toHaveText("non-pret");

  // 4) Redessine le bailleur : à nouveau prêt.
  await tracerAuDoigt(client, trajetDiagonal(boiteBailleur));
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
