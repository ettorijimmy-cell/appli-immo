import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { ArchiverBailLocataireDto } from "./archiver-bail-locataire.dto";
import { UpdateBailLocataireDto } from "./update-bail-locataire.dto";

describe("UpdateBailLocataireDto", () => {
  it("accepte une date AAAA-MM-JJ et null (effacement)", async () => {
    for (const dateEffetConge of ["2027-03-15", null]) {
      expect(await validate(plainToInstance(UpdateBailLocataireDto, { dateEffetConge }))).toHaveLength(0);
    }
  });

  it("refuse une date absente, mal formée ou inexistante", async () => {
    for (const corps of [{}, { dateEffetConge: "15/03/2027" }, { dateEffetConge: "2027-02-30" }, { dateEffetConge: "" }]) {
      const erreurs = await validate(plainToInstance(UpdateBailLocataireDto, corps));
      expect(erreurs.some((e) => e.property === "dateEffetConge")).toBe(true);
    }
  });
});

describe("ArchiverBailLocataireDto", () => {
  it("date facultative : absente, passée ou future acceptée", async () => {
    for (const corps of [{}, { dateEffetConge: "2026-01-31" }, { dateEffetConge: "2099-12-31" }]) {
      expect(await validate(plainToInstance(ArchiverBailLocataireDto, corps))).toHaveLength(0);
    }
  });

  it("refuse une date mal formée ou inexistante", async () => {
    for (const dateEffetConge of ["31/01/2026", "2026-02-30", ""]) {
      const erreurs = await validate(plainToInstance(ArchiverBailLocataireDto, { dateEffetConge }));
      expect(erreurs.some((e) => e.property === "dateEffetConge")).toBe(true);
    }
  });
});
