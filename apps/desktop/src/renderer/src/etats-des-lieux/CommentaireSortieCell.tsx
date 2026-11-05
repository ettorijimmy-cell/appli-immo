import { LONGUEUR_MAX_OBSERVATION_SORTIE } from "core";
import { classeChamp } from "./figement-carte";

// Zone de texte, jamais un simple <input> : un commentaire saisi sur plusieurs
// lignes sur le mobile perdrait ses retours à la ligne à l'affichage, puis en
// base au premier enregistrement depuis le desktop.
export function CommentaireSortieCell({
  nomLigne,
  value,
  onChange,
  editable
}: {
  nomLigne: string;
  value: string;
  onChange: (valeur: string) => void;
  editable: boolean;
}): React.JSX.Element {
  return (
    <td className="py-1 pr-2 align-top">
      <textarea
        aria-label={`Commentaire de sortie : ${nomLigne}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={!editable}
        maxLength={LONGUEUR_MAX_OBSERVATION_SORTIE}
        rows={value === "" ? 1 : 3}
        className={`block w-full min-w-40 rounded border px-2 py-1 text-sm ${classeChamp(editable)}`}
      />
    </td>
  );
}
