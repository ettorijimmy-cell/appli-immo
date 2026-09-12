// Onglet réservé (Module Charges et fiscalité, Étape 4 — export formulaire
// 2072/2033, non construit ici) : structure de navigation en place dès
// l'Étape 3, contenu réel à venir. Ne construit rien de l'export lui-même.
export function FiscaliteView(): React.JSX.Element {
  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold">Fiscalité</h1>
      <p className="text-sm text-slate-500">
        L'export de la déclaration fiscale (formulaire 2072/2033) arrive dans une prochaine étape.
      </p>
    </div>
  );
}
