// Harnais navigateur réel de la page d'état des lieux : la vraie page et le
// vrai parcours, sans authentification. Tous les appels réseau sont
// interceptés par page.route() côté test, jamais un vrai backend.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EtatDesLieuxPage } from "../src/pages/EtatDesLieuxPage";
import "../src/index.css";

const racine = document.getElementById("root");
if (!racine) {
  throw new Error("#root introuvable dans remise.html");
}
createRoot(racine).render(
  <StrictMode>
    <MemoryRouter initialEntries={["/bail/bail-test"]}>
      <Routes>
        <Route path="/" element={<p>Liste des baux</p>} />
        <Route path="bail/:bailId" element={<EtatDesLieuxPage />} />
      </Routes>
    </MemoryRouter>
  </StrictMode>
);
