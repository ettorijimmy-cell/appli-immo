// Sélecteur de plage de dates, extrait du motif inline dupliqué dans
// TableauDeBordPage.tsx (Module 7) — Module Charges et fiscalité, Étape 3
// en a besoin une deuxième fois (cockpit "Vue d'ensemble" de Finances),
// le bon moment pour factoriser plutôt que dupliquer une troisième fois.
export function PeriodeFilter({
  debut,
  fin,
  onChange
}: {
  debut: string;
  fin: string;
  onChange: (periode: { debut: string; fin: string }) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-medium text-slate-700">Période</span>
      <input
        type="date"
        value={debut}
        onChange={(e) => onChange({ debut: e.target.value, fin })}
        className="rounded-md border border-slate-300 px-2 py-1"
      />
      <span className="text-slate-400">→</span>
      <input
        type="date"
        value={fin}
        onChange={(e) => onChange({ debut, fin: e.target.value })}
        className="rounded-md border border-slate-300 px-2 py-1"
      />
    </div>
  );
}
