// Dérive le `basename` de react-router depuis import.meta.env.BASE_URL —
// la valeur canonique que Vite calcule lui-même à partir de l'option
// `base` du build (voir vite.config.ts, MOBILE_WEB_BASE_PATH). Un seul
// endroit écrit le préfixe de montage (/mobile/ aujourd'hui) : ce module
// ne fait que l'adapter au format attendu par react-router, jamais ne le
// redéfinit — condition de réversibilité vers un hébergement séparé.
//
// BASE_URL a toujours une barre finale ("/mobile/", "/"), que
// BrowserRouter n'attend pas : "/" reste "/" (son défaut, aucun préfixe),
// tout le reste perd sa barre finale ("/mobile/" -> "/mobile").
export function resoudreBasename(baseUrl: string): string {
  if (baseUrl === "/") {
    return "/";
  }
  return baseUrl.replace(/\/$/, "");
}
