import { describe, expect, it } from "vitest";
import type { Contact, ContactUnifie } from "./api";
import { lignesCarnet } from "./lignes-carnet";

const locataire: ContactUnifie = { type: "locataire", id: "l1", nom: "Ilan Devos", telephone: null, email: null };
const artisanActif: Contact = {
  id: "c1",
  nom: "Plomberie Martin",
  typeEntite: "entreprise",
  role: "artisan",
  telephone: "0600000000",
  email: null,
  notes: null,
  archivedAt: null
};
const artisanArchive: Contact = { ...artisanActif, id: "c2", nom: "Électricité Roux", archivedAt: "2026-11-13T10:00:00.000Z" };
const unifieArtisanActif: ContactUnifie = {
  type: "artisan",
  id: "c1",
  nom: "Plomberie Martin",
  telephone: "0600000000",
  email: null
};

describe("lignesCarnet", () => {
  it("par défaut : la liste unifiée seule, rien d'archivé", () => {
    expect(lignesCarnet([locataire, unifieArtisanActif], [artisanActif, artisanArchive], false)).toEqual([
      { ...locataire, archive: false },
      { ...unifieArtisanActif, archive: false }
    ]);
  });

  it("avec « Afficher les archivés » : ajoute les seuls contacts professionnels archivés, marqués", () => {
    const lignes = lignesCarnet([locataire, unifieArtisanActif], [artisanActif, artisanArchive], true);
    expect(lignes).toHaveLength(3);
    expect(lignes[2]).toEqual({
      type: "artisan",
      id: "c2",
      nom: "Électricité Roux",
      telephone: "0600000000",
      email: null,
      archive: true
    });
    // Le contact actif n'est jamais dupliqué.
    expect(lignes.filter((l) => l.id === "c1")).toHaveLength(1);
  });
});
