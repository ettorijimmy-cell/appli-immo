import { Building2, FileText, LayoutDashboard, Settings, Users, Wallet, type LucideIcon } from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

// Ordre fixé par docs/app-spec.md, section 3bis : ne pas réordonner ni
// ajouter une 7e entrée sans fusionner deux entrées existantes.
export const navItems: NavItem[] = [
  { path: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { path: "/patrimoine", label: "Patrimoine", icon: Building2 },
  { path: "/locataires", label: "Locataires", icon: Users },
  { path: "/finances", label: "Finances", icon: Wallet },
  { path: "/documents", label: "Documents", icon: FileText },
  { path: "/parametres", label: "Paramètres", icon: Settings }
];
