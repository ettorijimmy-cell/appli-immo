import { AlertesListView } from "../alertes/AlertesListView";

export function TableauDeBordPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Tableau de bord</h1>
      <AlertesListView />
    </div>
  );
}
