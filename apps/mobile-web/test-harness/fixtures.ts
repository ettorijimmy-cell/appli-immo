import { expect, test as base } from "@playwright/test";

// Une boucle de rendu React (« Maximum update depth exceeded ») ou tout autre
// avertissement React ne fait échouer aucune assertion : il part seulement
// sur console.error. Chaque test échoue donc sur toute erreur console ou
// exception de page. Seule exception : la ligne que Chromium écrit lui-même
// pour une requête en échec, attendue ici car les pannes sont simulées.
const REQUETE_EN_ECHEC = /^Failed to load resource: /;

export const test = base.extend<{ sansErreurConsole: void }>({
  sansErreurConsole: [
    async ({ page }, use) => {
      const erreurs: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !REQUETE_EN_ECHEC.test(message.text())) {
          erreurs.push(message.text());
        }
      });
      page.on("pageerror", (erreur) => erreurs.push(erreur.message));
      await use();
      expect(erreurs, "erreurs relevées dans la console du navigateur").toEqual([]);
    },
    { auto: true }
  ]
});

export { expect };
