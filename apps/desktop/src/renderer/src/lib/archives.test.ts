import { describe, expect, it } from "vitest";
import { estArchive, lignesVisibles } from "./archives";

const actif = { id: "a", archivedAt: null };
const archive = { id: "b", archivedAt: "2026-11-13T10:00:00.000Z" };

describe("lignesVisibles", () => {
  it("masque les archivés par défaut", () => {
    expect(lignesVisibles([actif, archive], false)).toEqual([actif]);
  });

  it("les réaffiche avec « Afficher les archivés », dans le même ordre", () => {
    expect(lignesVisibles([archive, actif], true)).toEqual([archive, actif]);
  });

  it("ne modifie jamais la liste reçue", () => {
    const liste = [actif, archive];
    lignesVisibles(liste, false);
    expect(liste).toEqual([actif, archive]);
  });
});

describe("estArchive", () => {
  it("vrai seulement pour une ligne connue et archivée", () => {
    expect(estArchive(archive)).toBe(true);
    expect(estArchive(actif)).toBe(false);
    expect(estArchive(undefined)).toBe(false);
  });
});
