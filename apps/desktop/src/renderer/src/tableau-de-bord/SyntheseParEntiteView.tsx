import { useEffect, useState } from "react";
import { ARCHIVED_ROW_CLASSNAME, ArchiveBadge, ArchiveToggle } from "../components/ArchiveFilter";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { getSynthese, type SyntheseSci } from "./api";

function pourcentage(taux: number): string {
  return `${Math.round(taux * 100)}%`;
}

// Revenu BRUT (loyer net, aucune dépense déduite) — jamais une
// "rentabilité nette", qui nécessiterait un suivi des charges réelles
// absent du MVP actuel (docs/backlog.md, dette technique).
//
// Les totaux SCI/immeuble incluent TOUJOURS le revenu réel de la période,
// y compris celui d'un appartement archivé depuis (docs/data-dictionary.md,
// section Tableau de bord — évite la divergence silencieuse avec le
// graphique "Revenus locatifs"). Le bouton "Afficher les archivés" ne
// masque/affiche que les LIGNES de détail par appartement, il ne fait
// jamais varier les totaux affichés au-dessus.
export function SyntheseParEntiteView({ debut, fin }: { debut: string; fin: string }): React.JSX.Element {
  const [synthese, setSynthese] = useState<SyntheseSci[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    void getSynthese(debut, fin).then(setSynthese);
  }, [debut, fin]);

  if (!synthese) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Synthèse par SCI / immeuble / appartement</h2>
        <ArchiveToggle show={showArchived} onToggle={() => setShowArchived((v) => !v)} />
      </div>
      <p className="text-xs text-slate-500">
        Revenu brut (loyer net, aucune dépense déduite) et taux d'occupation réel sur la période choisie. Les totaux
        incluent toujours les biens archivés depuis, même si leur ligne de détail est masquée.
      </p>
      <div className="space-y-2">
        {synthese.map((sci) => (
          <CollapsibleSection
            key={sci.id}
            title={`${sci.nom} — ${sci.revenuNet} € — occupation ${pourcentage(sci.tauxOccupation)}`}
            defaultOpen={false}
          >
            <div className="space-y-2 pl-4">
              {sci.immeubles.map((immeuble) => (
                <div key={immeuble.id}>
                  <p className="text-sm font-medium text-slate-700">
                    {immeuble.nom} — {immeuble.revenuNet} € — occupation {pourcentage(immeuble.tauxOccupation)}
                  </p>
                  <table className="ml-4 w-full max-w-lg text-left text-sm">
                    <tbody>
                      {immeuble.appartements
                        .filter((appartement) => showArchived || !appartement.archive)
                        .map((appartement) => (
                          <tr
                            key={appartement.id}
                            className={`border-b border-slate-100 ${appartement.archive ? ARCHIVED_ROW_CLASSNAME : ""}`}
                          >
                            <td className="py-1">
                              n°{appartement.numero}
                              {appartement.archive && <ArchiveBadge />}
                            </td>
                            <td className="py-1">{appartement.revenuNet} €</td>
                            <td className="py-1">{pourcentage(appartement.tauxOccupation)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        ))}
      </div>
    </div>
  );
}
