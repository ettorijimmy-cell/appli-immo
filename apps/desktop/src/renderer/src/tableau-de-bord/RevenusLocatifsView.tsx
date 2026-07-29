import type { RevenusLocatifs } from "./api";

export function moisParDefaut(): { debut: string; fin: string } {
  const maintenant = new Date();
  const fin = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0);
  const debut = new Date(maintenant.getFullYear(), maintenant.getMonth() - 5, 1);
  const formater = (d: Date) => d.toISOString().slice(0, 10);
  return { debut: formater(debut), fin: formater(fin) };
}

// Barres en CSS pur (pas de bibliothèque de graphiques) — cohérent avec
// l'absence de dépendance de ce type ailleurs dans le projet ; à réévaluer
// si un vrai besoin de visualisation plus riche apparaît.
//
// Affiche uniquement le loyer NET (docs/data-dictionary.md, section
// paiements — "Revenus locatifs") : la part provisions est délibérément
// exclue d'ici et affichée dans sa propre section ("Provisions
// collectées", ProvisionsCollecteesView) — les deux ne se recoupent
// jamais, jamais un seul graphique combinant les deux comme un seul total.
export function RevenusLocatifsView({ revenus }: { revenus: RevenusLocatifs | null }): React.JSX.Element {
  if (!revenus) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  const maxValeur = Math.max(1, ...revenus.parMois.map((m) => Number(m.loyerNet)));

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-700">Revenus locatifs (loyer net)</h2>
      <div className="flex items-end gap-3 rounded-lg border border-slate-200 p-4" style={{ height: 160 }}>
        {revenus.parMois.map((m) => (
          <div key={m.mois} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-col justify-end" style={{ height: 120 }}>
              <div
                className="w-full bg-indigo-700"
                style={{ height: (Number(m.loyerNet) / maxValeur) * 120 }}
                title={`${m.loyerNet} €`}
              />
            </div>
            <span className="text-xs text-slate-500">{m.mois}</span>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-600">Total sur la période : {revenus.totalLoyerNet} €</p>
    </div>
  );
}
