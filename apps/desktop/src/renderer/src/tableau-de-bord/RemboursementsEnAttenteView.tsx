import { useEffect, useState } from "react";
import { chargerContexteBail, creerCachesContexteBail } from "../finances/contexte-bail";
import { createRemboursement, type PaiementMode } from "../finances/api";
import { getRemboursementsEnAttente, type RemboursementEnAttente } from "./api";

const PAIEMENT_MODES: PaiementMode[] = ["virement", "cheque", "especes", "caf"];

// Calculé à la volée côté backend (docs/data-dictionary.md, section
// "versements & remboursements") : reste visible tant qu'aucun
// remboursement ne couvre le trop-perçu, y compris après un archivage
// ultérieur du bien (même principe que le correctif Module 7 sur les
// revenus/le taux d'occupation). La création du remboursement reste un
// acte humain explicite, jamais automatique.
export function RemboursementsEnAttenteView(): React.JSX.Element | null {
  const [enAttente, setEnAttente] = useState<RemboursementEnAttente[] | null>(null);
  const [contextes, setContextes] = useState<Map<string, string>>(new Map());
  const [enCoursDeCreation, setEnCoursDeCreation] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    const resultat = await getRemboursementsEnAttente();
    setEnAttente(resultat);
    const caches = creerCachesContexteBail();
    const map = new Map<string, string>();
    await Promise.all(
      resultat.map(async (r) => {
        const contexte = await chargerContexteBail(r.bailId, caches);
        map.set(
          r.bailId,
          `${contexte.sciNom} / ${contexte.immeubleNom} / n°${contexte.appartementNumero} — ${contexte.locatairesNoms || "sans locataire"}`
        );
      })
    );
    setContextes(map);
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (!enAttente || enAttente.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-900">Remboursements en attente</h2>
      <ul className="space-y-3">
        {enAttente.map((r) => (
          <li key={r.paiementId} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-amber-900">
              {contextes.get(r.bailId) ?? "…"} — trop-perçu de <strong>{r.montant} €</strong>
            </span>
            {enCoursDeCreation === r.paiementId ? (
              <RemboursementForm
                remboursement={r}
                onCreated={() => {
                  setEnCoursDeCreation(null);
                  void refresh();
                }}
                onCancel={() => setEnCoursDeCreation(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEnCoursDeCreation(r.paiementId)}
                className="shrink-0 rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                Créer le remboursement
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RemboursementForm({
  remboursement,
  onCreated,
  onCancel
}: {
  remboursement: RemboursementEnAttente;
  onCreated: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [montantRembourse, setMontantRembourse] = useState(remboursement.montant);
  const [dateRemboursement, setDateRemboursement] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<PaiementMode>("virement");
  const [commentaire, setCommentaire] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      await createRemboursement({
        bailId: remboursement.bailId,
        paiementId: remboursement.paiementId,
        type: "trop_percu",
        montantOrigine: remboursement.montant,
        montantRembourse,
        ...(commentaire ? { commentaire } : {}),
        dateRemboursement,
        mode
      });
      onCreated();
    } catch {
      setError("Impossible de créer le remboursement");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-md border border-amber-300 bg-white p-2">
      <div className="space-y-0.5">
        <label htmlFor="remboursement-montant" className="text-xs font-medium text-slate-700">
          Montant remboursé
        </label>
        <input
          id="remboursement-montant"
          value={montantRembourse}
          onChange={(e) => setMontantRembourse(e.target.value)}
          className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="space-y-0.5">
        <label htmlFor="remboursement-date" className="text-xs font-medium text-slate-700">
          Date
        </label>
        <input
          id="remboursement-date"
          type="date"
          value={dateRemboursement}
          onChange={(e) => setDateRemboursement(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <div className="space-y-0.5">
        <label htmlFor="remboursement-mode" className="text-xs font-medium text-slate-700">
          Mode
        </label>
        <select
          id="remboursement-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as PaiementMode)}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {PAIEMENT_MODES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-0.5">
        <label htmlFor="remboursement-commentaire" className="text-xs font-medium text-slate-700">
          Commentaire (si écart)
        </label>
        <input
          id="remboursement-commentaire"
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          placeholder="Optionnel"
          className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          void handleSubmit();
        }}
        disabled={isSubmitting}
        className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {isSubmitting ? "Création…" : "Valider"}
      </button>
      <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">
        Annuler
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
