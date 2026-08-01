import { describe, expect, it } from "vitest";
import { IndicesIrlService } from "./indices-irl.service";

// Réponse INSEE réelle (BDM 001515333, lastNObservations=1), capturée lors
// de la vérification de l'endpoint (docs/backlog.md, section "Édition d'un
// bail") — tronquée aux éléments pertinents pour ce test.
const REPONSE_INSEE_REELLE = `<?xml version='1.0' encoding='UTF-8'?><message:StructureSpecificData xmlns:ss="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/structurespecific"><message:DataSet><Series IDBANK="001515333" FREQ="T" TITLE_FR="Indice de référence des loyers (IRL)"><Obs TIME_PERIOD="2026-Q2" OBS_VALUE="148.37" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A" DATE_JO="2026-07-12"/></Series></message:DataSet></message:StructureSpecificData>`;

describe("IndicesIrlService.parserReponseInsee", () => {
  const service = new IndicesIrlService({} as never);

  it("extrait année/trimestre/valeur d'une réponse INSEE réelle", () => {
    const observation = service.parserReponseInsee(REPONSE_INSEE_REELLE);
    expect(observation).toEqual({ annee: 2026, trimestre: 2, valeur: "148.37" });
  });

  it("fonctionne quel que soit l'ordre des attributs dans la balise Obs", () => {
    const xml = `<Obs OBS_VALUE="150.00" DATE_JO="2026-10-15" TIME_PERIOD="2026-Q4" OBS_STATUS="A"/>`;
    expect(service.parserReponseInsee(xml)).toEqual({ annee: 2026, trimestre: 4, valeur: "150.00" });
  });

  it("rejette une réponse sans balise Obs", () => {
    expect(() => service.parserReponseInsee("<Series></Series>")).toThrow(/aucune observation/i);
  });

  it("rejette une balise Obs sans TIME_PERIOD ou OBS_VALUE exploitable", () => {
    expect(() => service.parserReponseInsee(`<Obs OBS_STATUS="A"/>`)).toThrow(/période ou valeur/i);
  });
});
