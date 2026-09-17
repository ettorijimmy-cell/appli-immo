import { ExecuterJobDiagnostic } from "../alertes/ExecuterJobDiagnostic";
import { ParametresAlertesView } from "../alertes/ParametresAlertesView";
import { CalendrierAbonnementView } from "../calendrier/CalendrierAbonnementView";
import { ConnexionGmailView } from "../gmail/ConnexionGmailView";
import { ConfigurationBoiteMailDedieeView } from "../messagerie/ConfigurationBoiteMailDedieeView";
import { ExecuterJobSyncDiagnostic } from "../messagerie/ExecuterJobSyncDiagnostic";
import { ExecuterJobTachesDiagnostic } from "../taches/ExecuterJobTachesDiagnostic";

export function ParametresPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Paramètres</h1>
      <ParametresAlertesView />
      <ConfigurationBoiteMailDedieeView />
      {/* ConnexionGmailView : intégration OAuth dormante depuis l'unification
          vers la boîte mail dédiée (2026-09-16) — plus rien ne l'appelle en
          usage réel, conservée sans suppression tant que la nouvelle voie
          n'a pas été éprouvée (décision actée avec Jimmy). */}
      <ConnexionGmailView />
      <CalendrierAbonnementView />
      <ExecuterJobDiagnostic />
      <ExecuterJobTachesDiagnostic />
      <ExecuterJobSyncDiagnostic />
    </div>
  );
}
