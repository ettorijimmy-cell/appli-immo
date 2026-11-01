import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";

export type ComportementSimulateurGotenberg =
  | { type: "succes" }
  | { type: "erreur"; statut: number }
  | { type: "attendre"; porte: Promise<void> };

export interface OptionsSimulateurGotenberg {
  // Si renseignés, le simulateur exige l'en-tête Authorization Basic
  // correspondant sur /forms/libreoffice/convert et répond 401 sinon.
  // Désactivé par défaut : comportement historique de ce simulateur
  // (Basic Auth jamais vérifié) — voir
  // etat-des-lieux-pdf.integration.spec.ts, qui ne le renseigne pas.
  identifiantsExiges?: { username: string; password: string };
}

export interface SimulateurGotenberg {
  url: string;
  fermer: () => Promise<void>;
  definirComportement: (c: ComportementSimulateurGotenberg) => void;
  // Code HTTP renvoyé par GET /health, indépendant de definirComportement
  // (qui ne régit que /forms/libreoffice/convert) — 200 par défaut.
  definirStatutSante: (code: number) => void;
  nombreAppels: () => number;
  reinitialiser: () => void;
}

// Simulateur Gotenberg minimal (chantier PDF étape 4, 2026-10-27, étendu
// 2026-11-01 pour le diagnostic) : un vrai serveur HTTP local, jamais un
// mock de fetch — exerce tout le chemin réel de GotenbergService
// (multipart, Basic Auth, Content-Type/signature de la réponse).
// Comportement mutable entre les tests (succès/erreur/attente contrôlée),
// un seul process par instance (démarrée une fois par fichier de test,
// réutilisée par chaque cas).
export function creerSimulateurGotenberg(options: OptionsSimulateurGotenberg = {}): Promise<SimulateurGotenberg> {
  let comportement: ComportementSimulateurGotenberg = { type: "succes" };
  let statutSante = 200;
  let appels = 0;
  const serveur: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(statutSante).end();
        return;
      }
      if (req.method !== "POST" || req.url !== "/forms/libreoffice/convert") {
        res.writeHead(404).end();
        return;
      }
      if (options.identifiantsExiges) {
        const attendu = `Basic ${Buffer.from(
          `${options.identifiantsExiges.username}:${options.identifiantsExiges.password}`
        ).toString("base64")}`;
        if (req.headers["authorization"] !== attendu) {
          res.writeHead(401).end();
          return;
        }
      }
      appels++;
      // Corps multipart reçu (drainé, jamais parsé — seul le comportement
      // de réponse configuré par le test importe ici) : attend la fin du
      // flux avant de répondre, comme le ferait un vrai appel réseau.
      await new Promise<void>((resolve) => {
        req.resume();
        req.once("end", resolve);
      });
      const c = comportement;
      if (c.type === "attendre") {
        await c.porte;
      }
      if (c.type === "erreur") {
        res.writeHead(c.statut, { "content-type": "text/plain" }).end("erreur simulée");
        return;
      }
      const pdf = Buffer.concat([Buffer.from("%PDF-1.4 "), Buffer.from(`pdf-simule-${appels}`)]);
      res.writeHead(200, { "content-type": "application/pdf" }).end(pdf);
    })();
  });
  return new Promise((resolve) => {
    serveur.listen(0, "127.0.0.1", () => {
      const adresse = serveur.address();
      if (!adresse || typeof adresse === "string") {
        throw new Error("Échec du démarrage du simulateur Gotenberg");
      }
      resolve({
        url: `http://127.0.0.1:${adresse.port}`,
        fermer: () => new Promise((r) => serveur.close(() => r())),
        definirComportement: (c) => {
          comportement = c;
        },
        definirStatutSante: (code) => {
          statutSante = code;
        },
        nombreAppels: () => appels,
        reinitialiser: () => {
          appels = 0;
        }
      });
    });
  });
}
