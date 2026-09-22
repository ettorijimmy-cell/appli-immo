import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOSSIER_TEMP_DOCUMENTS, ecrireFichierTemporaire, validerNomFichierDocx, viderDossierTemporaire } from "./documents-temp";

// Pas de mock de node:fs/promises : ces fonctions ne dépendent d'aucune API
// Electron (app/shell/ipcMain), seulement du système de fichiers — testées
// directement contre un vrai dossier temporaire jetable, même esprit que
// les tests d'intégration backend contre un vrai Postgres (CLAUDE.md :
// aucun test automatisé possible sur l'ouverture réelle avec l'app système,
// mais la logique fichier elle-même n'a pas besoin d'Electron pour être
// vérifiée).
describe("documents-temp", () => {
  let dossierTempRacine: string;

  beforeEach(async () => {
    dossierTempRacine = join(os.tmpdir(), `appli-immo-documents-temp-test-${randomUUID()}`);
    await mkdir(dossierTempRacine, { recursive: true });
  });

  afterEach(async () => {
    await rm(dossierTempRacine, { recursive: true, force: true });
  });

  describe("validerNomFichierDocx", () => {
    it("accepte un nom de fichier .docx et le renvoie tel quel", () => {
      expect(validerNomFichierDocx("bail-abc123.docx")).toBe("bail-abc123.docx");
    });

    it("accepte l'extension .docx quelle que soit sa casse", () => {
      expect(validerNomFichierDocx("bail.DOCX")).toBe("bail.DOCX");
    });

    it("rejette une extension autre que .docx", () => {
      expect(() => validerNomFichierDocx("bail.pdf")).toThrow(/\.docx/);
      expect(() => validerNomFichierDocx("script.exe")).toThrow(/\.docx/);
      expect(() => validerNomFichierDocx("sans-extension")).toThrow(/\.docx/);
    });

    it("élimine tout séparateur de chemin avant validation (protection traversal)", () => {
      expect(validerNomFichierDocx("../../evil.docx")).toBe("evil.docx");
      expect(validerNomFichierDocx("/etc/passwd.docx")).toBe("passwd.docx");
    });

    it("rejette une tentative de traversal déguisée en .docx.exe (basename garde l'extension réelle)", () => {
      expect(() => validerNomFichierDocx("../../evil.docx.exe")).toThrow(/\.docx/);
    });
  });

  describe("ecrireFichierTemporaire", () => {
    it("écrit le buffer sur disque et renvoie un chemin lisible avec le même contenu", async () => {
      const contenu = Buffer.from("contenu docx factice", "utf8");
      const chemin = await ecrireFichierTemporaire(dossierTempRacine, "bail-test.docx", contenu);

      expect(chemin.endsWith("bail-test.docx")).toBe(true);
      expect(chemin.startsWith(join(dossierTempRacine, DOSSIER_TEMP_DOCUMENTS))).toBe(true);
      const relu = await readFile(chemin);
      expect(relu.equals(contenu)).toBe(true);
    });

    it("rejette avant toute écriture si l'extension n'est pas .docx", async () => {
      await expect(ecrireFichierTemporaire(dossierTempRacine, "bail.pdf", Buffer.from("x"))).rejects.toThrow(/\.docx/);
      // Aucune écriture n'a eu lieu : le dossier temporaire dédié n'existe
      // même pas encore (mkdir n'est atteint qu'après la validation).
      await expect(stat(join(dossierTempRacine, DOSSIER_TEMP_DOCUMENTS))).rejects.toThrow();
    });

    it("deux écritures successives du même nomFichier atterrissent dans des sous-dossiers distincts (jamais de collision)", async () => {
      const chemin1 = await ecrireFichierTemporaire(dossierTempRacine, "quittance.docx", Buffer.from("v1"));
      const chemin2 = await ecrireFichierTemporaire(dossierTempRacine, "quittance.docx", Buffer.from("v2"));

      expect(chemin1).not.toBe(chemin2);
      const [contenu1, contenu2] = await Promise.all([readFile(chemin1, "utf8"), readFile(chemin2, "utf8")]);
      expect(contenu1).toBe("v1");
      expect(contenu2).toBe("v2");
    });
  });

  describe("viderDossierTemporaire", () => {
    it("supprime entièrement le dossier temporaire dédié, y compris son contenu", async () => {
      await ecrireFichierTemporaire(dossierTempRacine, "a.docx", Buffer.from("a"));
      await ecrireFichierTemporaire(dossierTempRacine, "b.docx", Buffer.from("b"));
      const dossierDedie = join(dossierTempRacine, DOSSIER_TEMP_DOCUMENTS);
      expect((await readdir(dossierDedie)).length).toBeGreaterThan(0);

      await viderDossierTemporaire(dossierTempRacine);

      await expect(stat(dossierDedie)).rejects.toThrow();
    });

    it("ne lève jamais si le dossier temporaire dédié n'existe pas encore (premier lancement)", async () => {
      await expect(viderDossierTemporaire(dossierTempRacine)).resolves.toBeUndefined();
    });

    it("ne touche jamais aux fichiers en dehors du dossier temporaire dédié", async () => {
      const fichierVoisin = join(dossierTempRacine, "ne-pas-toucher.txt");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(fichierVoisin, "important");
      await ecrireFichierTemporaire(dossierTempRacine, "c.docx", Buffer.from("c"));

      await viderDossierTemporaire(dossierTempRacine);

      const relu = await readFile(fichierVoisin, "utf8");
      expect(relu).toBe("important");
    });
  });
});
