import { ExecuterJobDiagnostic } from "../alertes/ExecuterJobDiagnostic";
import { ParametresAlertesView } from "../alertes/ParametresAlertesView";
import { CalendrierAbonnementView } from "../calendrier/CalendrierAbonnementView";
// ConnexionGmailView désactivée (import + montage JSX ci-dessous), décision
// actée avec Jimmy le 2026-09-22 — voir docs/data-dictionary.md, section
// "Gmail". Fichier gmail/ConnexionGmailView.tsx (et gmail/api.ts) laissés
// intacts pour une réactivation future : import { ConnexionGmailView }
// from "../gmail/ConnexionGmailView";
import { ConfigurationBoiteMailDedieeView } from "../messagerie/ConfigurationBoiteMailDedieeView";
import { ExecuterJobSyncDiagnostic } from "../messagerie/ExecuterJobSyncDiagnostic";
import { ExecuterJobTachesDiagnostic } from "../taches/ExecuterJobTachesDiagnostic";

export function ParametresPage(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Paramètres</h1>
      <ParametresAlertesView />
      <ConfigurationBoiteMailDedieeView />
      {/* ConnexionGmailView désactivée le 2026-09-22 (décision actée avec
          Jimmy) : intégration OAuth dormante depuis l'unification vers la
          boîte mail dédiée (2026-09-16), plus aucun bouton visible
          aujourd'hui. Backend en miroir : GoogleOAuthModule retiré des
          imports d'AppModule (apps/backend/src/app.module.ts) — les 3
          routes /gmail/* ne sont plus enregistrées. <ConnexionGmailView />
          */}
      <CalendrierAbonnementView />
      <ExecuterJobDiagnostic />
      <ExecuterJobTachesDiagnostic />
      <ExecuterJobSyncDiagnostic />
    </div>
  );
}
