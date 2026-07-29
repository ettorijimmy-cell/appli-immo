import { Outlet } from "react-router-dom";
import { Breadcrumb } from "./Breadcrumb";
import { BreadcrumbProvider } from "./breadcrumb-context";
import { Sidebar } from "./Sidebar";

export function AppLayout(): React.JSX.Element {
  return (
    <BreadcrumbProvider>
      <div className="flex h-screen bg-white text-slate-900">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="border-b border-slate-200 px-6 py-3">
            <Breadcrumb />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
