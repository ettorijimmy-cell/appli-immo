import { LogOut } from "lucide-react";
import { NavLink } from "react-router-dom";
import brikyLogo from "../../briky-logo-sidebar.png";
import { useAuth } from "../auth/AuthContext";
import { cn } from "../lib/utils";
import { navItems } from "./nav-items";

export function Sidebar(): React.JSX.Element {
  const { logout } = useAuth();

  return (
    <nav
      aria-label="Navigation principale"
      className="flex w-56 flex-col gap-1 border-r border-brand-navy-2 bg-brand-navy p-3"
    >
      <div className="mb-3 flex items-center gap-2 px-3 py-2">
        <img src={brikyLogo} alt="" className="h-8 w-8" aria-hidden="true" />
        <span className="text-base font-bold text-white">Briky</span>
      </div>

      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/"}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-300 hover:bg-brand-navy-2",
              isActive && "bg-brand-navy-2 text-white"
            )
          }
        >
          <item.icon className="h-4 w-4" aria-hidden="true" />
          {item.label}
        </NavLink>
      ))}

      <button
        type="button"
        onClick={logout}
        className="mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-300 hover:bg-brand-navy-2"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Se déconnecter
      </button>
    </nav>
  );
}
