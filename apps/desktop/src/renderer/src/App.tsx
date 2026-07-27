import { HashRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AppLayout } from "./layout/AppLayout";
import { DocumentsPage } from "./pages/DocumentsPage";
import { FinancesPage } from "./pages/FinancesPage";
import { LocatairesPage } from "./pages/LocatairesPage";
import { LoginPage } from "./pages/LoginPage";
import { ParametresPage } from "./pages/ParametresPage";
import { PatrimoinePage } from "./pages/PatrimoinePage";
import { TableauDeBordPage } from "./pages/TableauDeBordPage";

function AuthenticatedApp(): React.JSX.Element {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<TableauDeBordPage />} />
        <Route path="patrimoine" element={<PatrimoinePage />} />
        <Route path="locataires" element={<LocatairesPage />} />
        <Route path="finances" element={<FinancesPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="parametres" element={<ParametresPage />} />
      </Route>
    </Routes>
  );
}

function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <HashRouter>
        <AuthenticatedApp />
      </HashRouter>
    </AuthProvider>
  );
}

export default App;
