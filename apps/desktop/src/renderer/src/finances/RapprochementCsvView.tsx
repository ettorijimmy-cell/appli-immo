import { normaliserMontant } from "core";
import { useState, type ChangeEvent } from "react";
import { chargerContexteBail, creerCachesContexteBail } from "./contexte-bail";
import { enregistrerPaiement, rapprocherCsv, type RapprocherCsvResult } from "./api";

export function RapprochementCsvView(): React.JSX.Element {
  const [contenuFichier, setContenuFichier] = useState("");
  const [nomFichier, setNomFichier] = useState<string | null>(null);
  const [resultat, setResultat] = useState<RapprocherCsvResult | null>(null);
  const [contextesParPaiement, setContextesParPaiement] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmesParLigne, setConfirmesParLigne] = useState<Set<string>>(new Set());

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const fichier = event.target.files?.[0];
    if (!fichier) {
      return;
    }
    const texte = await fichier.text();
    setContenuFichier(texte);
    setNomFichier(fichier.name);
    setResultat(null);
    setConfirmesParLigne(new Set());
  }

  async function handleImporter(): Promise<void> {
    setError(null);
    setIsLoading(true);
    try {
      const resultatImport = await rapprocherCsv(contenuFichier);
      setResultat(resultatImport);
      setConfirmesParLigne(new Set());

      const caches = creerCachesContexteBail();
      const contextes = new Map<string, string>();
      await Promise.all(
        resultatImport.paiements.map(async (paiement) => {
          const contexte = await chargerContexteBail(paiement.bailId, caches);
          contextes.set(
            paiement.id,
            `${contexte.sciNom} / ${contexte.immeubleNom} / n°${contexte.appartementNumero} — ${contexte.locatairesNoms}`
          );
        })
      );
      setContextesParPaiement(contextes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'importer ce fichier");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirmer(ligneId: string, paiementId: string): Promise<void> {
    const ligne = resultat?.lignes.find((l) => l.id === ligneId);
    if (!ligne) {
      return;
    }
    // Le CSV importé peut porter une virgule décimale (format bancaire
    // français) — normaliserMontant (packages/core) est la même fonction
    // que celle appliquée côté DTO backend (défense en profondeur, pas une
    // seconde interprétation du format).
    await enregistrerPaiement(paiementId, {
      montantPaye: normaliserMontant(ligne.montant),
      mode: "virement",
      datePaiement: ligne.date,
      referenceRapprochement: ligne.libelle
    });
    setConfirmesParLigne((precedent) => new Set(precedent).add(ligneId));
  }

  const paiementParId = new Map((resultat?.paiements ?? []).map((paiement) => [paiement.id, paiement]));

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Import CSV — rapprochement bancaire</h1>
      <p className="text-sm text-slate-500">
        Chaque proposition ci-dessous reste à confirmer manuellement — rien n'est jamais rapproché
        automatiquement, même en cas de correspondance apparemment évidente.
      </p>

      <div className="flex items-center gap-4 rounded-lg border border-slate-200 p-4">
        <input
          id="finances-csv-fichier"
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
            void handleImporter();
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

      {resultat && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {resultat.lignes.length} ligne(s) lues, {resultat.propositions.length} proposition(s) de
            rapprochement.
          </p>

          {resultat.lignes.map((ligne) => {
            const proposition = resultat.propositions.find((p) => p.ligneCsvId === ligne.id);
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
                              void handleConfirmer(ligne.id, candidat.paiementId);
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
    </div>
  );
}
