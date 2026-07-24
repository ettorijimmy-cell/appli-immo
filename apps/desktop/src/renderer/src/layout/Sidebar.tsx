import { LogOut } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { cn } from "../lib/utils";
import { navItems } from "./nav-items";

export function Sidebar(): React.JSX.Element {
  const { logout } = useAuth();

  return (
    <nav
      aria-label="Navigation principale"
      className="flex w-56 flex-col gap-1 border-r border-slate-200 bg-slate-50 p-3"
    >
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === "/"}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100",
              isActive && "bg-indigo-50 text-indigo-700"
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
        className="mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Se déconnecter
      </button>
    </nav>
  );
}
