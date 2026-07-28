import { ParametresAlertesView } from "../alertes/ParametresAlertesView";

export function ParametresPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Paramètres</h1>
      <ParametresAlertesView />
    </div>
  );
}
