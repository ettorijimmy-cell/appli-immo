// Point d'entrée du harnais de test navigateur réel (Playwright) — monte
// SignatureStepScreen directement, sans authentification ni routeur :
// l'appel réseau (getSignatairesAttendus) est intercepté par
// page.route() côté test, jamais un vrai backend. Jamais construit en
// production (voir signature.html) ; sert uniquement à observer/piloter
// le composant depuis un vrai navigateur à largeur de téléphone, y
// compris un tracé tactile simulé (page.touchscreen), ce qu'aucun test
// jsdom/vitest ne peut reproduire fidèlement pour un <canvas>.
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { EtapeHandle } from "../src/etat-des-lieux/etape-handle";
import { SignatureStepScreen } from "../src/etat-des-lieux/SignatureStepScreen";
import type { SignerEtatDesLieuxInput } from "../src/api/etats-des-lieux";
import "../src/index.css";

function Harnais(): React.JSX.Element {
  const ref = useRef<EtapeHandle>(null);
  const [pret, setPret] = useState(false);
  const [statutEnvoi, setStatutEnvoi] = useState<"idle" | "envoi" | "ok" | "erreur">("idle");
  const [dernierEnvoi, setDernierEnvoi] = useState<string>("");

  async function terminer(): Promise<void> {
    setStatutEnvoi("envoi");
    try {
      await ref.current?.submit();
      setStatutEnvoi("ok");
    } catch {
      setStatutEnvoi("erreur");
    }
  }

  function onSubmit(input: SignerEtatDesLieuxInput): Promise<void> {
    setDernierEnvoi(
      JSON.stringify({
        bailleurNom: input.bailleur.nomAffiche,
        bailleurLu: input.bailleur.luEtApprouve,
        bailleurImageLongueur: input.bailleur.imagePng.length,
        lieu: input.lieu,
        locataires: input.locataires.map((l) => ({ id: l.locataireId, lu: l.luEtApprouve, imgLen: l.imagePng.length }))
      })
    );
    // Simule l'appel réseau réel signer-entree/signer-sortie — le test
    // intercepte l'appel getSignatairesAttendus via page.route(), celui-ci
    // est volontairement simulé ici (pas de vrai backend dans ce harnais).
    return Promise.resolve();
  }

  return (
    <div style={{ maxWidth: 400, margin: "0 auto", padding: 16, fontFamily: "sans-serif" }}>
      <p data-testid="pret">{pret ? "pret" : "non-pret"}</p>
      <SignatureStepScreen
        ref={ref}
        etatDesLieuxId="edl-test-harnais"
        mode="entree"
        onPretChange={setPret}
        onSubmit={onSubmit}
      />
      <button type="button" data-testid="terminer" disabled={!pret} onClick={() => void terminer()}>
        Terminer
      </button>
      <p data-testid="statut-envoi">{statutEnvoi}</p>
      <pre data-testid="dernier-envoi">{dernierEnvoi}</pre>
    </div>
  );
}

const racine = document.getElementById("root");
if (!racine) {
  throw new Error("#root introuvable dans signature.html");
}
createRoot(racine).render(
  <StrictMode>
    <Harnais />
  </StrictMode>
);
