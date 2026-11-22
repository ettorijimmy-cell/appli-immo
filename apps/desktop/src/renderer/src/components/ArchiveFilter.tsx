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

// Fiche archivée ouverte (petites suites, décision 4 du 2026-11-22) : plus
// de bouton « Modifier » ni « Archiver » ; cette mention les remplace. Le
// backend refuse de toute façon (409), et son message s'affiche si une
// action passe quand même (messageErreurApi).
export const TEXTE_FICHE_ARCHIVEE = "Fiche archivée : elle ne peut plus être modifiée.";

export function MentionFicheArchivee(): React.JSX.Element {
  return <span className="text-sm text-slate-500">{TEXTE_FICHE_ARCHIVEE}</span>;
}
