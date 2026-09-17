import { MessagerieView } from "../messagerie/MessagerieView";

export function MessageriePage(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col space-y-4">
      <h1 className="text-lg font-semibold">Messagerie</h1>
      <div className="flex-1">
        <MessagerieView />
      </div>
    </div>
  );
}
