// Pas de types officiels publiés pour ce module gratuit/communautaire
// (voir docs/backlog.md, test du 2026-08-02) — déclaration minimale
// couvrant uniquement l'usage réel fait ici (BailDocumentDocxService,
// EtatDesLieuxDocumentDocxService).
declare module "docxtemplater-image-module-free" {
  interface ImageModuleOptions {
    centered?: boolean;
    getImage: (tagValue: string, tagName: string) => Buffer;
    getSize: (img: Buffer, tagValue: string, tagName: string) => [number, number];
  }

  export default class ImageModule {
    constructor(options: ImageModuleOptions);
  }
}
