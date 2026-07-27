import { useState } from "react";

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-700"
        aria-expanded={open}
      >
        {title}
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="border-t border-slate-200 p-4">{children}</div>}
    </section>
  );
}
