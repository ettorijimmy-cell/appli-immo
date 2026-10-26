import { defineConfig, devices } from "@playwright/test";

// Harnais de navigateur réel pour SignatureStepScreen (test-harness/) —
// jamais un test e2e de l'application complète (pas d'auth, pas de vrai
// backend, le seul appel réseau du composant est intercepté via
// page.route()). Existe précisément parce que jsdom/vitest ne peut pas
// reproduire fidèlement un <canvas> piloté au doigt (signature_pad) : un
// vrai moteur de rendu est nécessaire pour vérifier le tracé tactile.
export default defineConfig({
  testDir: "./test-harness",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5174",
    // Pixel 7 (Chromium) plutôt qu'un device iPhone (WebKit par défaut) :
    // le tracé tactile est simulé via le CDP Input.dispatchTouchEvent
    // (tracerAuDoigt, signature.spec.ts), une commande spécifique à
    // Chromium — WebKit/Firefox n'exposent pas newCDPSession().
    ...devices["Pixel 7"],
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm exec vite --port 5174 --strictPort",
    url: "http://localhost:5174/test-harness/signature.html",
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000
  }
});
