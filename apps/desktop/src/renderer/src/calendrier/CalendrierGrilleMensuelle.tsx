import { ajouterMois, decomposerDate, formaterDateIso, jourDeLaSemaine, joursDansLeMois, libelleMoisDepuisDate } from "core";
import { useMemo, useState } from "react";
import { EVENEMENT_TYPE_LABELS, type EvenementCalendrier } from "./api";

const JOURS_SEMAINE = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function dateDuJourLocale(): string {
  const maintenant = new Date();
  return formaterDateIso(maintenant.getFullYear(), maintenant.getMonth() + 1, maintenant.getDate());
}

// Jour calendaire LOCAL (pas UTC) d'un timestamp ISO — même compensation de
// fuseau que versInputDatetimeLocal (CalendrierView), pour que l'événement
// apparaisse sur la bonne case même si son heure UTC déborde sur le jour
// suivant/précédent en heure locale.
function dateLocaleDepuisIso(iso: string): string {
  const date = new Date(iso);
  return formaterDateIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

interface Cellule {
  date: string | null;
  jour: number | null;
}

// Grille faite main (7 colonnes lundi->dimanche, semaines en lignes) — aucune
// bibliothèque de calendrier dans les dépendances du projet, cohérent avec le
// refus déjà acté de recharts pour un besoin similaire (SVG pur préféré à une
// dépendance, docs/backlog.md). Vue mensuelle uniquement pour cette
// itération — vue annuelle laissée pour plus tard si le besoin se confirme.
// Complément de la vue liste existante (bouton de bascule dans
// CalendrierView), pas un remplacement.
export function CalendrierGrilleMensuelle({
  evenements,
  onSelectEvenement
}: {
  evenements: EvenementCalendrier[];
  onSelectEvenement: (id: string) => void;
}): React.JSX.Element {
  const [moisAffiche, setMoisAffiche] = useState(() => {
    const { annee, mois } = decomposerDate(dateDuJourLocale());
    return formaterDateIso(annee, mois, 1);
  });

  const evenementsParJour = useMemo(() => {
    const map = new Map<string, EvenementCalendrier[]>();
    for (const evenement of evenements) {
      const jour = dateLocaleDepuisIso(evenement.dateDebut);
      const liste = map.get(jour) ?? [];
      liste.push(evenement);
      map.set(jour, liste);
    }
    for (const liste of map.values()) {
      liste.sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));
    }
    return map;
  }, [evenements]);

  const cellules = useMemo<Cellule[]>(() => {
    const { annee, mois } = decomposerDate(moisAffiche);
    const premierJourSemaine = jourDeLaSemaine(formaterDateIso(annee, mois, 1));
    const nbJours = joursDansLeMois(annee, mois);

    const liste: Cellule[] = [];
    for (let i = 0; i < premierJourSemaine; i++) {
      liste.push({ date: null, jour: null });
    }
    for (let jour = 1; jour <= nbJours; jour++) {
      liste.push({ date: formaterDateIso(annee, mois, jour), jour });
    }
    while (liste.length % 7 !== 0) {
      liste.push({ date: null, jour: null });
    }
    return liste;
  }, [moisAffiche]);

  const aujourdHui = dateDuJourLocale();
  const { annee } = decomposerDate(moisAffiche);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => setMoisAffiche(ajouterMois(moisAffiche, -1))}
          className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
          aria-label="Mois précédent"
        >
          ‹
        </button>
        <span className="text-sm font-semibold capitalize text-slate-700">
          {libelleMoisDepuisDate(moisAffiche)} {annee}
        </span>
        <button
          type="button"
          onClick={() => setMoisAffiche(ajouterMois(moisAffiche, 1))}
          className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
          aria-label="Mois suivant"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 text-xs">
        {JOURS_SEMAINE.map((jour) => (
          <div key={jour} className="bg-slate-50 py-1 text-center font-medium text-slate-500">
            {jour}
          </div>
        ))}
        {cellules.map((cellule, index) => (
          <div
            key={cellule.date ?? `vide-${index}`}
            className={`min-h-24 space-y-1 bg-white p-1 ${cellule.date === aujourdHui ? "bg-indigo-50" : ""}`}
          >
            {cellule.jour !== null && (
              <>
                <span
                  className={`text-xs ${cellule.date === aujourdHui ? "font-semibold text-indigo-700" : "text-slate-400"}`}
                >
                  {cellule.jour}
                </span>
                <ul className="space-y-0.5">
                  {(evenementsParJour.get(cellule.date!) ?? []).map((evenement) => (
                    <li key={evenement.id}>
                      <button
                        type="button"
                        onClick={() => onSelectEvenement(evenement.id)}
                        title={`${EVENEMENT_TYPE_LABELS[evenement.type]} — ${evenement.titre}`}
                        className="w-full truncate rounded bg-indigo-100 px-1 py-0.5 text-left text-xs text-indigo-800 hover:bg-indigo-200"
                      >
                        {evenement.titre}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
