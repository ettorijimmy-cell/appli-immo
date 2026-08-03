import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AccueilPage } from "./pages/AccueilPage";

// Routes de base uniquement — les écrans réels (parcours pas-à-pas de
// saisie de l'état des lieux) restent à concevoir, voir docs/backlog.md,
// section "État des lieux". BrowserRouter (URLs propres) plutôt que
// HashRouter (utilisé côté apps/desktop, nécessaire là-bas car Electron
// charge un index.html local en file://) — cette app est servie sur un
// vrai serveur HTTP, l'hébergement définitif (sous-chemin du backend ou
// statique séparé) reste à trancher au provisionnement Scaleway.
function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<AccueilPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
