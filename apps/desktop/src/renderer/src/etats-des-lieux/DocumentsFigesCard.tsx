import { useEffect, useState } from "react";
import { DocumentApercuModal } from "../documents/DocumentApercuModal";
import { listerDocumentsFigesEtatDesLieux, produirePdfEtatDesLieux, type StatutDocumentsFigesPhase } from "./api";
import { EnvoiEtatDesLieuxPanel } from "./EnvoiEtatDesLieuxPanel";
import { HistoriqueEnvoisEtatDesLieux } from "./HistoriqueEnvoisEtatDesLieux";
import { messageErreurCartePdf } from "./message-erreur-carte-pdf";
import { libelleStatutPdf } from "./statut-pdf-etat-des-lieux";
import { useEtatDesLieuxPdfApercu } from "./use-etat-des-lieux-pdf-apercu";

const LABEL_PHASE: Record<"entree" | "sortie", string> = { entree: "Entrée", sortie: "Sortie" };

// Documents PDF figés de l'état des lieux (chantier PDF étape 4b) — même
// principe que SignaturesCard : rien tant qu'aucune phase n'est signée.
// Statut (voir statut-pdf-etat-des-lieux.ts) : "Prêt" (PDF présent),
// "En préparation" (.docx présent depuis moins de 30 min, sans le PDF),
// "Échec de la conversion" (.docx présent depuis plus de 30 min, toujours
// sans le PDF), "Indisponible" (ni l'un ni l'autre). Bouton "Produire le
// PDF" visible dans tous les cas où le PDF manque (idempotent côté
// backend — ne produit que ce qui manque), jamais pour une phase non
// signée. Tout message d'erreur affiché est celui du backend quand il est
// exploitable, jamais le générique NestJS brut (voir message-erreur-carte-pdf.ts).
export function DocumentsFigesCard({
  etatDesLieuxId,
  entreeSigneeParTous,
  sortieSigneeParTous
}: {
  etatDesLieuxId: string;
  entreeSigneeParTous: boolean;
  sortieSigneeParTous: boolean;
}): React.JSX.Element | null {
  const [statuts, setStatuts] = useState<StatutDocumentsFigesPhase[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [phaseEnCours, setPhaseEnCours] = useState<"entree" | "sortie" | null>(null);
  const [version, setVersion] = useState(0);
  const [phaseEnvoi, setPhaseEnvoi] = useState<"entree" | "sortie" | null>(null);
  const [versionEnvois, setVersionEnvois] = useState(0);
  const { apercu, erreur: erreurApercu, ouvrir, fermer } = useEtatDesLieuxPdfApercu(etatDesLieuxId);

  useEffect(() => {
    let annule = false;
    listerDocumentsFigesEtatDesLieux(etatDesLieuxId)
      .then((donnees) => {
        if (!annule) {
          setStatuts(donnees);
        }
      })
      .catch((err: unknown) => {
        if (!annule) {
          setErreur(messageErreurCartePdf(err, "Impossible de récupérer l'état des documents PDF."));
        }
      });
    return () => {
      annule = true;
    };
    // version force un nouveau chargement après un "Produire le PDF"
    // réussi — l'effet ne dépend d'aucune autre donnée dérivée.
  }, [etatDesLieuxId, version]);

  if (!entreeSigneeParTous && !sortieSigneeParTous) {
    return null;
  }

  async function handleProduire(phase: "entree" | "sortie"): Promise<void> {
    setPhaseEnCours(phase);
    setErreur(null);
    try {
      await produirePdfEtatDesLieux(etatDesLieuxId, phase);
      setVersion((v) => v + 1);
    } catch (err) {
      setErreur(messageErreurCartePdf(err, "Une erreur est survenue lors de la production du PDF."));
    } finally {
      setPhaseEnCours(null);
    }
  }

  const phasesSignees = (["entree", "sortie"] as const).filter((phase) =>
    phase === "entree" ? entreeSigneeParTous : sortieSigneeParTous
  );

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h4 className="mb-2 text-sm font-semibold text-slate-700">Documents PDF</h4>
      {erreur && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          {erreur}
        </p>
      )}
      {erreurApercu && (
        <p role="alert" className="mb-2 text-xs text-red-600">
          {erreurApercu}
        </p>
      )}
      <div className="space-y-2">
        {phasesSignees.map((phase) => {
          const statut = statuts.find((s) => s.phase === phase);
          return (
            <div key={phase}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-600">
                  <span className="font-medium text-slate-700">{LABEL_PHASE[phase]}</span> — {libelleStatutPdf(statut)}
                </span>
                <div className="flex gap-2">
                  {statut?.pdf && (
                    <button
                      type="button"
                      onClick={() => void ouvrir(phase)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Ouvrir le PDF
                    </button>
                  )}
                  {statut?.pdf && (
                    <button
                      type="button"
                      onClick={() => setPhaseEnvoi(phaseEnvoi === phase ? null : phase)}
                      className="rounded border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                    >
                      Envoyer au locataire
                    </button>
                  )}
                  {!statut?.pdf && (
                    <button
                      type="button"
                      onClick={() => void handleProduire(phase)}
                      disabled={phaseEnCours === phase}
                      className="rounded border border-indigo-300 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                    >
                      {phaseEnCours === phase ? "Production…" : "Produire le PDF"}
                    </button>
                  )}
                </div>
              </div>
              {phaseEnvoi === phase && (
                <EnvoiEtatDesLieuxPanel
                  etatDesLieuxId={etatDesLieuxId}
                  phase={phase}
                  onFermer={() => setPhaseEnvoi(null)}
                  onEnvoiTermine={() => setVersionEnvois((v) => v + 1)}
                />
              )}
            </div>
          );
        })}
      </div>
      <HistoriqueEnvoisEtatDesLieux etatDesLieuxId={etatDesLieuxId} version={versionEnvois} />
      {apercu && <DocumentApercuModal apercu={apercu} onClose={fermer} />}
    </div>
  );
}
