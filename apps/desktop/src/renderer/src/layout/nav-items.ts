import {
  BookUser,
  Building2,
  CalendarDays,
  FileText,
  LayoutDashboard,
  ListTodo,
  Settings,
  ShieldAlert,
  UserSearch,
  Users,
  Wallet,
  type LucideIcon
} from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

// Ordre fixé par docs/app-spec.md, section 3bis. La limite de 6 entrées
// (et la règle "7e entrée = fusion de deux") a été levée explicitement
// par Jimmy le 2026-09-05 — voir docs/app-spec.md pour l'historique et le
// raisonnement, ce n'est pas un oubli si cette liste dépasse 6 entrées.
export const navItems: NavItem[] = [
  { path: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { path: "/patrimoine", label: "Patrimoine", icon: Building2 },
  { path: "/locataires", label: "Locataires", icon: Users },
  { path: "/contacts", label: "Carnet de contacts", icon: BookUser },
  { path: "/candidats", label: "Candidats", icon: UserSearch },
  { path: "/calendrier", label: "Calendrier", icon: CalendarDays },
  { path: "/finances", label: "Finances", icon: Wallet },
  { path: "/documents", label: "Documents", icon: FileText },
  { path: "/taches", label: "Tâches", icon: ListTodo },
  { path: "/sinistres", label: "Sinistres", icon: ShieldAlert },
  { path: "/parametres", label: "Paramètres", icon: Settings }
];
