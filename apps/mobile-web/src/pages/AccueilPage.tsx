import { API_BASE_URL } from "../lib/api-config";

// Placeholder — confirme que le build/routing/config API fonctionnent.
// Remplacé par le vrai parcours de saisie une fois les écrans conçus.
export function AccueilPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">Appli Immo — État des lieux</h1>
        <p className="text-sm text-slate-500">Backend : {API_BASE_URL}</p>
      </div>
    </div>
  );
}
