import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

// Confirmation avant création (2026-11-05) : la vraie page d'état des lieux,
// backend simulé par page.route(). Aucun état des lieux n'existe au départ ;
// seul un POST /etats-des-lieux en crée un.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS"
};

function json(route: Route, corps: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(corps) });
}

const EDL_CREE = {
  id: "edl-cree",
  bailId: "bail-test",
  dateEntree: null,
  dateSortie: null,
  lieuEntree: null,
  lieuSortie: null,
  nouvelleAdresseLocataire: null,
  statut: "non_commence",
  archivedAt: null,
  motifAbandon: null,
  entreeSigneeParTous: false,
  sortieSigneeParTous: false,
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

async function simulerBackend(page: Page): Promise<{ creations: unknown[] }> {
  const etat = { creations: [] as unknown[], cree: false };
  await page.route("http://localhost:3000/**", async (route) => {
    const requete = route.request();
    const { pathname, search } = new URL(requete.url());
    const methode = requete.method();
    if (methode === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (pathname === "/baux/bail-test") {
      return json(route, {
        id: "bail-test",
        appartementId: "appt",
        typeBail: "vide",
        statut: "actif",
        dateDebut: "2026-08-01",
        dateFin: null,
        archivedAt: null
      });
    }
    if (pathname === "/appartements/appt") {
      return json(route, {
        id: "appt",
        bienId: "bien",
        numero: "12",
        nombreChambres: 0,
        nombreSallesDeBain: 0,
        nombreWc: 0,
        autrePiece1: null,
        autrePiece2: null
      });
    }
    if (pathname === "/etats-des-lieux" && methode === "POST") {
      etat.creations.push(requete.postDataJSON());
      etat.cree = true;
      return json(route, EDL_CREE, 201);
    }
    if (pathname === "/etats-des-lieux" && search.includes("bailId")) {
      return json(route, etat.cree ? EDL_CREE : null);
    }
    return json(route, []);
  });
  return etat;
}

test("création : rien n'est créé sans confirmation, Annuler ne crée rien", async ({ page }) => {
  const etat = await simulerBackend(page);
  await page.goto("/test-harness/remise.html");

  await page.getByRole("button", { name: "Démarrer l'état des lieux" }).click();
  await expect(page.getByText("Démarrer l'état des lieux ?")).toBeVisible();
  await expect(page.getByText("Logement n° 12, bail du 01/08/2026.")).toBeVisible();
  expect(etat.creations).toEqual([]);

  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Aucun état des lieux pour ce bail.")).toBeVisible();
  expect(etat.creations).toEqual([]);
});

test("création : la confirmation crée l'état des lieux une seule fois et ouvre le parcours", async ({ page }) => {
  const etat = await simulerBackend(page);
  await page.goto("/test-harness/remise.html");

  await page.getByRole("button", { name: "Démarrer l'état des lieux" }).click();
  await page.getByRole("button", { name: "Confirmer et démarrer" }).click();

  await expect(page.getByText("Aucun état des lieux pour ce bail.")).toHaveCount(0);
  await expect(page.getByText(/\d+\/\d+/).first()).toBeVisible();
  expect(etat.creations).toEqual([{ bailId: "bail-test" }]);
});
