// Conteneur de dialogue modal partagé (confirmations, saisies courtes) :
// fond assombri, boîte centrée, titre. Né dans l'état des lieux
// (BrouillonEtatDesLieux.tsx), déplacé ici quand les Documents s'en sont
// servis à leur tour.
export function Modale({ titre, children }: { titre: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-label={titre} className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-base font-semibold">{titre}</h2>
        {children}
      </div>
    </div>
  );
}
