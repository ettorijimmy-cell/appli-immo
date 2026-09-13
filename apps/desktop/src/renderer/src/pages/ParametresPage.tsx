import { ExecuterJobDiagnostic } from "../alertes/ExecuterJobDiagnostic";
import { ParametresAlertesView } from "../alertes/ParametresAlertesView";
import { CalendrierAbonnementView } from "../calendrier/CalendrierAbonnementView";
import { ConnexionGmailView } from "../gmail/ConnexionGmailView";
import { ExecuterJobTachesDiagnostic } from "../taches/ExecuterJobTachesDiagnostic";

export function ParametresPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Paramètres</h1>
      <ParametresAlertesView />
      <ConnexionGmailView />
      <CalendrierAbonnementView />
      <ExecuterJobDiagnostic />
      <ExecuterJobTachesDiagnostic />
    </div>
  );
}
