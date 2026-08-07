import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
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
  return (
    <AuthProvider>
      <BrowserRouter>
        <AuthenticatedApp />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
