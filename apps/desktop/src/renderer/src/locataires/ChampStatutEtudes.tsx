import type { LocataireStatutEtudes } from "./api";
import { LIBELLES_STATUT_ETUDES, STATUTS_ETUDES } from "./statut-etudes";

// Champ « Statut d'études », partagé par la création (LocatairesListView) et
// la modification (LocataireDetailView) d'un locataire.
export function ChampStatutEtudes({
  id,
  valeur,
  onChange
}: {
  id: string;
  valeur: LocataireStatutEtudes;
  onChange: (valeur: LocataireStatutEtudes) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        Statut d'études
      </label>
      <select
        id={id}
        value={valeur}
        onChange={(event) => onChange(event.target.value as LocataireStatutEtudes)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        {STATUTS_ETUDES.map((statut) => (
          <option key={statut} value={statut}>
            {LIBELLES_STATUT_ETUDES[statut]}
          </option>
        ))}
      </select>
    </div>
  );
}
