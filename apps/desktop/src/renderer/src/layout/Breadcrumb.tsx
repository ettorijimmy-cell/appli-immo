import { useLocation } from "react-router-dom";
import { useBreadcrumbSegmentsValue } from "./breadcrumb-context";
import { navItems } from "./nav-items";

export function Breadcrumb(): React.JSX.Element {
  const location = useLocation();
  const current = navItems.find((item) =>
    item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path)
  );
  // Segments additionnels posés par la fiche affichée (SCI > Immeuble >
  // Appartement, Locataire...) — voir breadcrumb-context.tsx.
  const segmentsFiche = useBreadcrumbSegmentsValue();

  return (
    <nav aria-label="Fil d'Ariane" className="text-sm text-slate-500">
      <span>Accueil</span>
      {current && current.path !== "/" && (
        <>
          <span className="mx-2">/</span>
          <span className={segmentsFiche.length > 0 ? undefined : "text-slate-900"}>{current.label}</span>
        </>
      )}
      {segmentsFiche.map((segment, index) => (
        <span key={`${segment}-${index}`}>
          <span className="mx-2">/</span>
          <span className={index === segmentsFiche.length - 1 ? "text-slate-900" : undefined}>{segment}</span>
        </span>
      ))}
    </nav>
  );
}
