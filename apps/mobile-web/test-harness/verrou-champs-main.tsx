// Harnais de test navigateur réel pour le verrou des champs communs
// (Clés/Équipements divers/Inventaire) — jamais construit en production
// (voir verrou-champs.html). Monte les 3 écrans deux fois : une fois en
// scénario "entrée signée seule", une fois en scénario "sortie signée",
// avec des préfixes de data-testid distincts pour les isoler côté test.
import { StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  ElementInventaireMeuble,
  LigneCle,
  LigneEquipementDivers,
  LigneInventaire
} from "../src/api/etats-des-lieux";
import { ClesStepScreen } from "../src/etat-des-lieux/ClesStepScreen";
import { EquipementsDiversStepScreen } from "../src/etat-des-lieux/EquipementsDiversStepScreen";
import type { EtapeHandle } from "../src/etat-des-lieux/etape-handle";
import { InventaireStepScreen } from "../src/etat-des-lieux/InventaireStepScreen";
import "../src/index.css";

const ligneCleExistante: LigneCle = {
  id: "cle-autre-1",
  etatDesLieuxId: "edl-test",
  typeCle: "autre",
  libelleAutre: "Cadenas cave",
  nombreEntree: 1,
  nombreSortie: null,
  commentaire: "RAS",
  archivedAt: null
};

const ligneEquipementExistante: LigneEquipementDivers = {
  id: "equip-1",
  etatDesLieuxId: "edl-test",
  libelle: "Aspirateur",
  nombreEntree: 1,
  etatEntree: "bon",
  nombreSortie: null,
  etatSortie: null,
  commentaire: "Un peu bruyant",
  archivedAt: null
};

const catalogue: ElementInventaireMeuble[] = [
  { id: "elem-vu", code: "VU", libelle: "Canapé (vu à l'entrée)", categorie: "meuble", ordreAffichage: 1 },
  { id: "elem-jamais-vu", code: "JAMAIS_VU", libelle: "Table basse (jamais vue)", categorie: "meuble", ordreAffichage: 2 }
];

const ligneInventaireExistante: LigneInventaire = {
  id: "inv-1",
  elementId: "elem-vu",
  nombreEntree: 1,
  etatEntree: "bon",
  nombreSortie: null,
  etatSortie: null,
  commentaire: "Petite tache",
  archivedAt: null,
  elementCode: "VU",
  elementLibelle: "Canapé (vu à l'entrée)",
  elementCategorie: "meuble",
  elementOrdreAffichage: 1
};

function Scenario({
  prefixe,
  entreeSignee,
  sortieSignee
}: {
  prefixe: string;
  entreeSignee: boolean;
  sortieSignee: boolean;
}): React.JSX.Element {
  const refCles = useRef<EtapeHandle>(null);
  const refEquipements = useRef<EtapeHandle>(null);
  const refInventaire = useRef<EtapeHandle>(null);

  return (
    <section data-testid={prefixe} style={{ border: "2px solid #ccc", margin: 16, padding: 16 }}>
      <h2>{prefixe}</h2>

      <div data-testid={`${prefixe}-cles`}>
        <h3>Clés</h3>
        <ClesStepScreen
          ref={refCles}
          lignes={[ligneCleExistante]}
          mode="sortie"
          entreeSignee={entreeSignee}
          sortieSignee={sortieSignee}
          onSubmit={() => Promise.resolve()}
        />
      </div>

      <div data-testid={`${prefixe}-equipements`}>
        <h3>Équipements divers</h3>
        <EquipementsDiversStepScreen
          ref={refEquipements}
          lignes={[ligneEquipementExistante]}
          mode="sortie"
          entreeSignee={entreeSignee}
          sortieSignee={sortieSignee}
          onSubmit={() => Promise.resolve()}
        />
      </div>

      <div data-testid={`${prefixe}-inventaire`}>
        <h3>Inventaire</h3>
        <InventaireStepScreen
          ref={refInventaire}
          catalogue={catalogue}
          lignes={[ligneInventaireExistante]}
          mode="sortie"
          entreeSignee={entreeSignee}
          sortieSignee={sortieSignee}
          onSubmit={() => Promise.resolve()}
        />
      </div>
    </section>
  );
}

function Harnais(): React.JSX.Element {
  return (
    <div>
      <Scenario prefixe="scenario-entree-signee" entreeSignee={true} sortieSignee={false} />
      <Scenario prefixe="scenario-sortie-signee" entreeSignee={true} sortieSignee={true} />
    </div>
  );
}

const racine = document.getElementById("root");
if (!racine) {
  throw new Error("#root introuvable dans verrou-champs.html");
}
createRoot(racine).render(
  <StrictMode>
    <Harnais />
  </StrictMode>
);
