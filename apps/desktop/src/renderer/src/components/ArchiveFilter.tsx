// Filtrage des éléments archivés, partagé par toutes les listes de
// l'application (Patrimoine, Locataires...) : masqués par défaut,
// réaffichables via un bouton, visuellement distincts (grisés + badge) une
// fois réaffichés.

export function ArchiveToggle({
  show,
  onToggle
}: {
  show: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button type="button" onClick={onToggle} className="text-sm text-slate-500 hover:text-slate-700">
      {show ? "Masquer les archivés" : "Afficher les archivés"}
    </button>
  );
}

export function ArchiveBadge(): React.JSX.Element {
  return (
    <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
      Archivé
    </span>
  );
}

export const ARCHIVED_ROW_CLASSNAME = "opacity-60";
