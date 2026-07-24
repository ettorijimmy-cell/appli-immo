import { useLocation } from "react-router-dom";
import { navItems } from "./nav-items";

export function Breadcrumb(): React.JSX.Element {
  const location = useLocation();
  const current = navItems.find((item) =>
    item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path)
  );

  return (
    <nav aria-label="Fil d'Ariane" className="text-sm text-slate-500">
      <span>Accueil</span>
      {current && current.path !== "/" && (
        <>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{current.label}</span>
        </>
      )}
    </nav>
  );
}
