import { useNavigate } from "react-router-dom";

// Amène directement aux écrans où se trouvent les formulaires "Nouveau
// paiement"/"Nouveau bail" (FinancesListView / LocatairesPage) : ces
// formulaires vivent dans un état local de composant, pas une route dédiée
// — l'accès rapide économise la navigation par le menu, pas le clic
// d'ouverture du formulaire lui-même.
export function AccesRapidesView(): React.JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => navigate("/finances")}
        className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
      >
        Nouveau paiement
      </button>
      <button
        type="button"
        onClick={() => navigate("/locataires")}
        className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800"
      >
        Nouveau bail
      </button>
    </div>
  );
}
