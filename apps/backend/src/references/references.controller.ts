import { Controller, Get, Param, StreamableFile } from "@nestjs/common";
import { ReferencesService } from "./references.service";

@Controller("references")
export class ReferencesController {
  constructor(private readonly referencesService: ReferencesService) {}

  @Get(":slug")
  async telecharger(@Param("slug") slug: string): Promise<StreamableFile> {
    const { contenu, nomFichier, mimeType } = await this.referencesService.telecharger(slug);
    return new StreamableFile(contenu, {
      type: mimeType,
      disposition: `attachment; filename="${encodeURIComponent(nomFichier)}"`
    });
  }
}
