import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: "node",
    include: ["**/*.integration.spec.ts"]
    // testTimeout par défaut (5000ms) conservé ici — voir vi.setConfig()
    // en tête des quelques fichiers qui produisent un .docx figé via
    // signerEntree/signerSortie (chantier PDF étape 4, 2026-10-27), seuls
    // concernés par le coût d'un vrai rendu docxtemplater.
  }
});
