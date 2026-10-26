import { expect, test, type Locator } from "@playwright/test";

// Vérifie le verrou des champs communs (Clés/Équipements divers/
// Inventaire) dans un vrai navigateur — voir verrou-champs-main.tsx pour
// les 2 scénarios montés (entrée signée seule / entrée+sortie signées) et
// champModifiable ("core", classification-champs-etat-des-lieux.ts) pour
// la règle elle-même, partagée avec le verrou backend et desktop. Pas
// d'appel réseau ici (ces 3 écrans sont de purs composants contrôlés par
// props), donc aucun page.route() n'est nécessaire — à la différence de
// signature.spec.ts.

// Les 3 écrans partagent exactement la même classe de conteneur par ligne
// ("space-y-2 border-b border-slate-100 pb-4 last:border-0") — permet de
// scoper chaque assertion à SA ligne précise plutôt qu'à tout l'écran, où
// une autre ligne (déjà existante, commentaire affiché) fausserait une
// vérification d'absence.
function lignes(conteneur: Locator): Locator {
  return conteneur.locator("div.space-y-2.border-b.border-slate-100.pb-4");
}

async function readOnly(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => (el as HTMLInputElement).readOnly);
}

async function attendreAbsenceCommentaire(ligne: Locator): Promise<void> {
  await expect(ligne.getByRole("button", { name: "+ Commentaire" })).toHaveCount(0);
  await expect(ligne.locator('label:text-is("+ Commentaire")')).toHaveCount(0);
}

test("entrée signée seule : ligne existante gelée sur son identité/commentaire, ligne neuve limitée à identité + sortie", async ({
  page
}) => {
  await page.goto("/test-harness/verrou-champs.html");
  const scenario = page.getByTestId("scenario-entree-signee");

  // --- Clés ---
  // ClesStepScreen rend d'abord les 6 types fixes (TYPES_CLE_FIXES), puis
  // les lignes "autre" — la ligne existante "Cadenas cave" est donc la
  // 7e ligne (index 6), pas la 1re.
  const cles = scenario.getByTestId("scenario-entree-signee-cles");
  const cleExistante = lignes(cles).nth(6);
  const libelleCleExistante = cleExistante.getByPlaceholder("Autre clé (libellé)");
  await expect(libelleCleExistante).toHaveValue("Cadenas cave");
  expect(await readOnly(libelleCleExistante)).toBe(true);
  expect(await readOnly(cleExistante.locator('input[type="number"]'))).toBe(false);
  const commentaireCleExistant = cleExistante.locator('label:text-is("+ Commentaire") ~ input');
  await expect(commentaireCleExistant).toHaveValue("RAS");
  expect(await readOnly(commentaireCleExistant)).toBe(true);

  await cles.getByRole("button", { name: "+ Ajouter une autre clé" }).click();
  const cleNeuve = lignes(cles).nth(7);
  const libelleCleNeuve = cleNeuve.getByPlaceholder("Autre clé (libellé)");
  await expect(libelleCleNeuve).toHaveValue("");
  expect(await readOnly(libelleCleNeuve)).toBe(false);
  expect(await readOnly(cleNeuve.locator('input[type="number"]'))).toBe(false);
  await attendreAbsenceCommentaire(cleNeuve);

  // --- Équipements divers ---
  const equipements = scenario.getByTestId("scenario-entree-signee-equipements");
  const equipExistant = lignes(equipements).nth(0);
  const libelleEquipExistant = equipExistant.getByPlaceholder("Équipement (ex. Store banne)");
  await expect(libelleEquipExistant).toHaveValue("Aspirateur");
  expect(await readOnly(libelleEquipExistant)).toBe(true);
  await expect(equipExistant.getByRole("button", { name: "Bon" })).toBeEnabled();
  expect(await readOnly(equipExistant.locator('input[type="number"]'))).toBe(false);
  const commentaireEquipExistant = equipExistant.locator('label:text-is("+ Commentaire") ~ input');
  await expect(commentaireEquipExistant).toHaveValue("Un peu bruyant");
  expect(await readOnly(commentaireEquipExistant)).toBe(true);

  await equipements.getByRole("button", { name: "+ Ajouter un équipement" }).click();
  const equipNeuf = lignes(equipements).nth(1);
  const libelleEquipNeuf = equipNeuf.getByPlaceholder("Équipement (ex. Store banne)");
  await expect(libelleEquipNeuf).toHaveValue("");
  expect(await readOnly(libelleEquipNeuf)).toBe(false);
  await expect(equipNeuf.getByRole("button", { name: "Bon" })).toBeEnabled();
  expect(await readOnly(equipNeuf.locator('input[type="number"]'))).toBe(false);
  await attendreAbsenceCommentaire(equipNeuf);

  // --- Inventaire (pas d'identité : elementId fixe du catalogue) ---
  const inventaire = scenario.getByTestId("scenario-entree-signee-inventaire");
  const invCanape = lignes(inventaire).nth(0);
  await expect(invCanape.getByRole("heading", { name: "Canapé (vu à l'entrée)" })).toBeVisible();
  await expect(invCanape.getByRole("button", { name: "Bon" })).toBeEnabled();
  expect(await readOnly(invCanape.locator('input[type="number"]'))).toBe(false);
  const commentaireInvExistant = invCanape.locator('label:text-is("+ Commentaire") ~ input');
  await expect(commentaireInvExistant).toHaveValue("Petite tache");
  expect(await readOnly(commentaireInvExistant)).toBe(true);

  // Poste du catalogue jamais vu à l'entrée (pas de ligne existante) :
  // sortie éditable, pas de commentaire possible/affiché.
  const invTableBasse = lignes(inventaire).nth(1);
  await expect(invTableBasse.getByRole("heading", { name: "Table basse (jamais vue)" })).toBeVisible();
  await expect(invTableBasse.getByRole("button", { name: "Bon" })).toBeEnabled();
  expect(await readOnly(invTableBasse.locator('input[type="number"]'))).toBe(false);
  await attendreAbsenceCommentaire(invTableBasse);
});

test("sortie signée : tout en lecture seule, plus aucun bouton d'ajout", async ({ page }) => {
  await page.goto("/test-harness/verrou-champs.html");
  const scenario = page.getByTestId("scenario-sortie-signee");

  // --- Clés --- (même décalage que dans le scénario entrée signée)
  const cles = scenario.getByTestId("scenario-sortie-signee-cles");
  const cleExistante = lignes(cles).nth(6);
  const libelleCle = cleExistante.getByPlaceholder("Autre clé (libellé)");
  await expect(libelleCle).toHaveValue("Cadenas cave");
  expect(await readOnly(libelleCle)).toBe(true);
  expect(await readOnly(cleExistante.locator('input[type="number"]'))).toBe(true);
  expect(await readOnly(cleExistante.locator('label:text-is("+ Commentaire") ~ input'))).toBe(true);
  await expect(cles.getByRole("button", { name: "+ Ajouter une autre clé" })).toHaveCount(0);

  // --- Équipements divers ---
  const equipements = scenario.getByTestId("scenario-sortie-signee-equipements");
  const equipExistant = lignes(equipements).nth(0);
  const libelleEquip = equipExistant.getByPlaceholder("Équipement (ex. Store banne)");
  await expect(libelleEquip).toHaveValue("Aspirateur");
  expect(await readOnly(libelleEquip)).toBe(true);
  await expect(equipExistant.getByRole("button", { name: "Bon" })).toBeDisabled();
  expect(await readOnly(equipExistant.locator('input[type="number"]'))).toBe(true);
  expect(await readOnly(equipExistant.locator('label:text-is("+ Commentaire") ~ input'))).toBe(true);
  await expect(equipements.getByRole("button", { name: "+ Ajouter un équipement" })).toHaveCount(0);

  // --- Inventaire ---
  const inventaire = scenario.getByTestId("scenario-sortie-signee-inventaire");
  const invCanape = lignes(inventaire).nth(0);
  await expect(invCanape.getByRole("button", { name: "Bon" })).toBeDisabled();
  expect(await readOnly(invCanape.locator('input[type="number"]'))).toBe(true);
  expect(await readOnly(invCanape.locator('label:text-is("+ Commentaire") ~ input'))).toBe(true);

  // Poste jamais vu à l'entrée : désormais lui aussi verrouillé en sortie.
  const invTableBasse = lignes(inventaire).nth(1);
  await expect(invTableBasse.getByRole("button", { name: "Bon" })).toBeDisabled();
  expect(await readOnly(invTableBasse.locator('input[type="number"]'))).toBe(true);
  await attendreAbsenceCommentaire(invTableBasse);
});
