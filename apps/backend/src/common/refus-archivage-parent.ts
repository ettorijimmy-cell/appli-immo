// Messages de refus d'archivage d'un bien ou d'une SCI (petites suites,
// décision 5 du 2026-11-22) : ils disent quoi faire d'abord, avec le
// nombre de fiches encore actives. Utilisés par BienService.archive et
// ScisService.archive.

export function messageBauxActifsBien(nombre: number): string {
  return nombre === 1
    ? "Ce bien a un bail actif ou en préavis. Résiliez-le d'abord, archivez ses appartements, puis archivez le bien."
    : `Ce bien a ${nombre} baux actifs ou en préavis. Résiliez-les d'abord, archivez ses appartements, puis archivez le bien.`;
}

export function messageAppartementsNonArchives(nombre: number): string {
  return nombre === 1
    ? "Archivez d'abord l'appartement de ce bien."
    : `Archivez d'abord les ${nombre} appartements de ce bien.`;
}

export function messageBauxActifsSci(nombre: number): string {
  return nombre === 1
    ? "Cette SCI a un bail actif ou en préavis sur ses biens. Résiliez-le d'abord, archivez les appartements et les biens, puis archivez la SCI."
    : `Cette SCI a ${nombre} baux actifs ou en préavis sur ses biens. Résiliez-les d'abord, archivez les appartements et les biens, puis archivez la SCI.`;
}

export function messageBiensNonArchives(nombre: number): string {
  return nombre === 1 ? "Archivez d'abord le bien de cette SCI." : `Archivez d'abord les ${nombre} biens de cette SCI.`;
}
