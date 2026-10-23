import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { resoudreBasename } from "./lib/base-path";
import { BauxPage } from "./pages/BauxPage";
import { EtatDesLieuxPage } from "./pages/EtatDesLieuxPage";
import { LoginPage } from "./pages/LoginPage";

// BrowserRouter (URLs propres) plutôt que HashRouter (utilisé côté
// apps/desktop, nécessaire là-bas car Electron charge un index.html local
// en file://) — cette app est servie sur un vrai serveur HTTP.
function AuthenticatedApp(): React.JSX.Element {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route index element={<BauxPage />} />
      <Route path="bail/:bailId" element={<EtatDesLieuxPage />} />
    </Routes>
  );
}

function App(): React.JSX.Element {
  // Dérivé de BASE_URL (fourni par Vite depuis l'option `base`, voir
  // vite.config.ts) plutôt que d'un test sur PROD : un seul endroit
  // (vite.config.ts) décide du préfixe de montage, jamais dupliqué ici —
  // condition de réversibilité vers un hébergement séparé (base "/").
  // React Router applique ce préfixe à toutes les routes, liens et
  // navigate() automatiquement, sans autre changement.
  const basename = resoudreBasename(import.meta.env.BASE_URL);

  return (
    <AuthProvider>
      <BrowserRouter basename={basename}>
        <AuthenticatedApp />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
