import { estMontantNegatif, valeurAbsolueMontant } from "core";
import { useState, type ChangeEvent } from "react";
import { libelleBien, listBiens, type Bien } from "../patrimoine/api";
import { listScis, type Sci } from "../scis/api";
import {
  createDepense,
  parserCsvDepenses,
  DEPENSE_CATEGORIES,
  DEPENSE_CATEGORIE_LABELS,
  type DepenseCategorie,
  type LigneReleveCsvDepense
} from "./api";

export function ImportCsvDepensesView(): React.JSX.Element {
  const [contenuFichier, setContenuFichier] = useState("");
  const [nomFichier, setNomFichier] = useState<string | null>(null);
  const [lignes, setLignes] = useState<LigneReleveCsvDepense[] | null>(null);
  const [biens, setBiens] = useState<Bien[]>([]);
  const [scis, setScis] = useState<Sci[]>([]);
  const [categorieParLigne, setCategorieParLigne] = useState<Map<string, DepenseCategorie>>(new Map());
  const [rattachementParLigne, setRattachementParLigne] = useState<Map<string, string>>(new Map());
  const [confirmeesParLigne, setConfirmeesParLigne] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmationEnCours, setConfirmationEnCours] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const fichier = event.target.files?.[0];
    if (!fichier) {
      return;
    }
    const texte = await fichier.text();
    setContenuFichier(texte);
    setNomFichier(fichier.name);
    setLignes(null);
    setConfirmeesParLigne(new Set());
  }

  async function handleAnalyser(): Promise<void> {
    setError(null);
    setIsLoading(true);
    try {
      const [lignesBrutes, biensBruts, scisBrutes] = await Promise.all([
        parserCsvDepenses(contenuFichier),
        listBiens(),
        listScis()
      ]);
      setLignes(lignesBrutes);
      setBiens(biensBruts);
      setScis(scisBrutes);
      setConfirmeesParLigne(new Set());
      setCategorieParLigne(new Map());
      setRattachementParLigne(new Map());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'analyser ce fichier");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirmer(ligne: LigneReleveCsvDepense): Promise<void> {
    const categorie = categorieParLigne.get(ligne.id);
    const rattachement = rattachementParLigne.get(ligne.id);
    if (!categorie || !rattachement) {
      return;
    }
    // Garde-fou en plus du filtrage à l'affichage ci-dessous (jamais créer
    // une dépense depuis une ligne de crédit — un encaissement n'est pas
    // une dépense, bug constaté en test manuel Electron le 2026-09-07).
    if (!estMontantNegatif(ligne.montant)) {
      return;
    }
    setError(null);
    setConfirmationEnCours(ligne.id);
    try {
      const [type, id] = rattachement.split(":");
      if (!id) {
        return;
      }
      // parserReleveCsv renvoie une ligne de débit en montant négatif
      // (convention du rapprochement bancaire, packages/core) — une dépense
      // est toujours positive (revue financial-logic-reviewer, 2026-09-07),
      // valeurAbsolueMontant retire ce signe en plus de normaliser la
      // virgule décimale (même définition que côté DTO backend, défense en
      // profondeur).
      await createDepense({
        categorie,
        montant: valeurAbsolueMontant(ligne.montant),
        dateDepense: ligne.date,
        libelle: ligne.libelle,
        ...(type === "bien" ? { bienId: id } : { sciId: id })
      });
      setConfirmeesParLigne((precedent) => new Set(precedent).add(ligne.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer cette dépense");
    } finally {
      setConfirmationEnCours(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Import CSV — dépenses</h1>
      <p className="text-sm text-slate-500">
        Chaque ligne de débit reste à catégoriser et rattacher manuellement — rien n'est jamais
        créé automatiquement, même quand le libellé semble évident. Les lignes de crédit
        (encaissements) sont affichées pour information mais ne peuvent jamais devenir une
        dépense.
      </p>

      <div className="flex items-center gap-4 rounded-lg border border-slate-200 p-4">
        <input
          id="depenses-csv-fichier"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            void handleFileChange(event);
          }}
          className="text-sm"
        />
        <button
          type="button"
          onClick={() => {
            void handleAnalyser();
          }}
          disabled={!contenuFichier || isLoading}
          className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {isLoading ? "Analyse…" : "Analyser le relevé"}
        </button>
        {nomFichier && <span className="text-sm text-slate-500">{nomFichier}</span>}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {lignes && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {lignes.length} ligne(s) lues, dont {lignes.filter((l) => estMontantNegatif(l.montant)).length}{" "}
            candidate(s) de dépense (lignes de débit).
          </p>

          {lignes.map((ligne) => {
            const confirmee = confirmeesParLigne.has(ligne.id);
            const estDebit = estMontantNegatif(ligne.montant);
            const categorie = categorieParLigne.get(ligne.id) ?? "";
            const rattachement = rattachementParLigne.get(ligne.id) ?? "";

            return (
              <div key={ligne.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {ligne.date} — {ligne.montant} € — {ligne.libelle}
                  </span>
                  {confirmee && <span className="font-medium text-green-700">Créée</span>}
                </div>

                {!confirmee && !estDebit && (
                  <p className="mt-2 text-sm text-slate-500">
                    Encaissement (crédit) — non applicable à une dépense.
                  </p>
                )}

                {!confirmee && estDebit && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      value={categorie}
                      onChange={(e) =>
                        setCategorieParLigne((precedent) =>
                          new Map(precedent).set(ligne.id, e.target.value as DepenseCategorie)
                        )
                      }
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="" disabled>
                        Catégorie…
                      </option>
                      {DEPENSE_CATEGORIES.map((valeur) => (
                        <option key={valeur} value={valeur}>
                          {DEPENSE_CATEGORIE_LABELS[valeur]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={rattachement}
                      onChange={(e) =>
                        setRattachementParLigne((precedent) => new Map(precedent).set(ligne.id, e.target.value))
                      }
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="" disabled>
                        Bien / SCI…
                      </option>
                      {biens.map((bien) => (
                        <option key={bien.id} value={`bien:${bien.id}`}>
                          {libelleBien(bien)}
                        </option>
                      ))}
                      {scis.map((sci) => (
                        <option key={sci.id} value={`sci:${sci.id}`}>
                          {sci.nom} (SCI, sans bien précis)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        void handleConfirmer(ligne);
                      }}
                      disabled={!categorie || !rattachement || confirmationEnCours === ligne.id}
                      className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
                    >
                      {confirmationEnCours === ligne.id ? "Création…" : "Créer cette dépense"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
