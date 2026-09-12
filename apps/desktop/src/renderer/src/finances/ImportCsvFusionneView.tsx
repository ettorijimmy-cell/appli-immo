import { estMontantNegatif, normaliserMontant, valeurAbsolueMontant } from "core";
import { useState, type ChangeEvent } from "react";
import {
  createDepense,
  parserCsvDepenses,
  DEPENSE_CATEGORIES,
  DEPENSE_CATEGORIE_LABELS,
  type DepenseCategorie,
  type LigneReleveCsvDepense
} from "../depenses/api";
import { libelleBien, listBiens, type Bien } from "../patrimoine/api";
import { listScis, type Sci } from "../scis/api";
import { chargerContexteBail, creerCachesContexteBail } from "./contexte-bail";
import { ajouterVersement, rapprocherCsv, type RapprocherCsvResult } from "./api";

// Module Charges et fiscalité, Étape 3 (docs/backlog.md) : un relevé
// bancaire réel contient à la fois des lignes de loyer (crédit) et des
// lignes de dépense (débit) — obliger à importer le même fichier deux
// fois (une fois sous Revenus, une fois sous Dépenses) était la confusion
// que cette fusion corrige. Un seul upload, une seule analyse (les deux
// endpoints existants sont appelés en parallèle avec le même contenu —
// aucune fusion côté backend, hors périmètre de cette étape), puis les
// lignes sont routées par signe vers deux sections indépendantes :
// "Revenus à rapprocher" (logique de l'ancien RapprochementCsvView,
// inchangée) et "Dépenses à créer" (logique de l'ancien
// ImportCsvDepensesView, inchangée).
export function ImportCsvFusionneView(): React.JSX.Element {
  const [contenuFichier, setContenuFichier] = useState("");
  const [nomFichier, setNomFichier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Section "Revenus à rapprocher".
  const [resultatRapprochement, setResultatRapprochement] = useState<RapprocherCsvResult | null>(null);
  const [contextesParPaiement, setContextesParPaiement] = useState<Map<string, string>>(new Map());
  const [confirmesParLigne, setConfirmesParLigne] = useState<Set<string>>(new Set());

  // Section "Dépenses à créer".
  const [lignesDepenses, setLignesDepenses] = useState<LigneReleveCsvDepense[] | null>(null);
  const [biens, setBiens] = useState<Bien[]>([]);
  const [scis, setScis] = useState<Sci[]>([]);
  const [categorieParLigne, setCategorieParLigne] = useState<Map<string, DepenseCategorie>>(new Map());
  const [rattachementParLigne, setRattachementParLigne] = useState<Map<string, string>>(new Map());
  const [confirmeesParLigne, setConfirmeesParLigne] = useState<Set<string>>(new Set());
  const [confirmationEnCours, setConfirmationEnCours] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const fichier = event.target.files?.[0];
    if (!fichier) {
      return;
    }
    const texte = await fichier.text();
    setContenuFichier(texte);
    setNomFichier(fichier.name);
    setResultatRapprochement(null);
    setLignesDepenses(null);
    setConfirmesParLigne(new Set());
    setConfirmeesParLigne(new Set());
  }

  async function handleAnalyser(): Promise<void> {
    setError(null);
    setIsLoading(true);
    try {
      const [resultatImport, lignesBrutes, biensBruts, scisBrutes] = await Promise.all([
        rapprocherCsv(contenuFichier),
        parserCsvDepenses(contenuFichier),
        listBiens(),
        listScis()
      ]);

      setResultatRapprochement(resultatImport);
      setConfirmesParLigne(new Set());
      const caches = creerCachesContexteBail();
      const contextes = new Map<string, string>();
      await Promise.all(
        resultatImport.paiements.map(async (paiement) => {
          const contexte = await chargerContexteBail(paiement.bailId, caches);
          contextes.set(
            paiement.id,
            `${contexte.sciNom ? `${contexte.sciNom} / ` : ""}${contexte.bienNom} / n°${contexte.appartementNumero} — ${contexte.locatairesNoms}`
          );
        })
      );
      setContextesParPaiement(contextes);

      setLignesDepenses(lignesBrutes);
      setBiens(biensBruts);
      setScis(scisBrutes);
      setConfirmeesParLigne(new Set());
      // Présélection uniquement (Module Charges et fiscalité, Étape 2) —
      // categorieSuggeree vient déjà de suggererCategorie côté backend.
      setCategorieParLigne(
        new Map(
          lignesBrutes
            .filter((ligne) => ligne.categorieSuggeree !== null)
            .map((ligne) => [ligne.id, ligne.categorieSuggeree!])
        )
      );
      setRattachementParLigne(new Map());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'analyser ce fichier");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirmerRapprochement(ligneId: string, paiementId: string): Promise<void> {
    const ligne = resultatRapprochement?.lignes.find((l) => l.id === ligneId);
    if (!ligne) {
      return;
    }
    await ajouterVersement({
      paiementId,
      montant: normaliserMontant(ligne.montant),
      mode: "virement",
      dateVersement: ligne.date,
      referenceRapprochement: ligne.libelle
    });
    setConfirmesParLigne((precedent) => new Set(precedent).add(ligneId));
  }

  async function handleConfirmerDepense(ligne: LigneReleveCsvDepense): Promise<void> {
    const categorie = categorieParLigne.get(ligne.id);
    const rattachement = rattachementParLigne.get(ligne.id);
    if (!categorie || !rattachement) {
      return;
    }
    // Garde-fou en plus du filtrage à l'affichage ci-dessous — jamais créer
    // une dépense depuis une ligne de crédit.
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

  const paiementParId = new Map((resultatRapprochement?.paiements ?? []).map((paiement) => [paiement.id, paiement]));
  // Une ligne de débit ne peut par construction jamais correspondre à un
  // paiement dû (toujours positif) — filtrage purement pour l'affichage,
  // afin de ne pas dupliquer dans cette section des lignes déjà couvertes
  // par "Dépenses à créer" ci-dessous.
  const lignesRapprochement = (resultatRapprochement?.lignes ?? []).filter((l) => !estMontantNegatif(l.montant));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Import CSV</h1>
        <p className="text-sm text-slate-500">
          Un seul relevé bancaire, analysé une fois : les lignes de crédit sont proposées comme
          rapprochements de loyer ci-dessous, les lignes de débit comme candidates de dépense plus
          bas. Rien n'est jamais créé automatiquement — chaque ligne reste à confirmer manuellement.
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-lg border border-slate-200 p-4">
        <input
          id="finances-csv-fusionne-fichier"
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

      {resultatRapprochement && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">Revenus à rapprocher</h2>
          <p className="text-sm text-slate-500">
            {lignesRapprochement.length} ligne(s) de crédit, {resultatRapprochement.propositions.length}{" "}
            proposition(s) de rapprochement.
          </p>

          {lignesRapprochement.map((ligne) => {
            const proposition = resultatRapprochement.propositions.find((p) => p.ligneCsvId === ligne.id);
            const confirmee = confirmesParLigne.has(ligne.id);

            return (
              <div key={ligne.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {ligne.date} — {ligne.montant} € — {ligne.libelle}
                  </span>
                  {confirmee && <span className="font-medium text-green-700">Rapproché</span>}
                </div>

                {confirmee ? null : !proposition ? (
                  <p className="mt-2 text-sm text-slate-500">Aucun paiement correspondant trouvé.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {proposition.candidats.map((candidat) => {
                      const paiement = paiementParId.get(candidat.paiementId);
                      if (!paiement) {
                        return null;
                      }
                      return (
                        <li
                          key={candidat.paiementId}
                          className="flex items-center justify-between rounded-md border border-slate-100 p-2"
                        >
                          <span>
                            {contextesParPaiement.get(paiement.id) ?? "…"} — {paiement.montant} € dû le{" "}
                            {paiement.dateEcheance} — critères : {candidat.criteresCorrespondants.join(", ")}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              void handleConfirmerRapprochement(ligne.id, candidat.paiementId);
                            }}
                            className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800"
                          >
                            Confirmer ce rapprochement
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {lignesDepenses && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">Dépenses à créer</h2>
          <p className="text-sm text-slate-500">
            {lignesDepenses.length} ligne(s) lues, dont{" "}
            {lignesDepenses.filter((l) => estMontantNegatif(l.montant)).length} candidate(s) de dépense
            (lignes de débit).
          </p>

          {lignesDepenses.map((ligne) => {
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
                        void handleConfirmerDepense(ligne);
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
