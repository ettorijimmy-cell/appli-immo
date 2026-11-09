import { describe, expect, it } from "vitest";
import { montantEnLettres, nombreEnLettres } from "./montant-en-lettres";

const euros = (n: number): number => n * 100;

describe("nombreEnLettres — cas pièges (orthographe rectifiée de 1990)", () => {
  it.each([
    [0, "zéro"],
    [1, "un"],
    [16, "seize"],
    [17, "dix-sept"],
    [21, "vingt-et-un"],
    [31, "trente-et-un"],
    [61, "soixante-et-un"],
    [70, "soixante-dix"],
    [71, "soixante-et-onze"],
    [72, "soixante-douze"],
    [77, "soixante-dix-sept"],
    [80, "quatre-vingts"],
    [81, "quatre-vingt-un"],
    [90, "quatre-vingt-dix"],
    [91, "quatre-vingt-onze"],
    [99, "quatre-vingt-dix-neuf"],
    [100, "cent"],
    [101, "cent-un"],
    [180, "cent-quatre-vingts"],
    [200, "deux-cents"],
    [201, "deux-cent-un"],
    [231, "deux-cent-trente-et-un"],
    [280, "deux-cent-quatre-vingts"],
    [999, "neuf-cent-quatre-vingt-dix-neuf"],
    [1000, "mille"],
    [1001, "mille-un"],
    [1080, "mille-quatre-vingts"],
    [1100, "mille-cent"],
    [1200, "mille-deux-cents"],
    [2000, "deux-mille"],
    [21_000, "vingt-et-un-mille"],
    [80_000, "quatre-vingt-mille"],
    [80_080, "quatre-vingt-mille-quatre-vingts"],
    [100_000, "cent-mille"],
    [200_000, "deux-cent-mille"],
    [200_200, "deux-cent-mille-deux-cents"],
    [1_000_000, "un million"],
    [2_000_000, "deux millions"],
    [1_000_001, "un million un"],
    [1_001_000, "un million mille"],
    [71_000, "soixante-et-onze-mille"],
    [81_000_000, "quatre-vingt-un millions"],
    [100_000_000, "cent millions"],
    [2_300_000, "deux millions trois-cent-mille"],
    [80_000_000, "quatre-vingts millions"],
    [200_000_000, "deux-cents millions"],
    [999_999_999, "neuf-cent-quatre-vingt-dix-neuf millions neuf-cent-quatre-vingt-dix-neuf-mille-neuf-cent-quatre-vingt-dix-neuf"]
  ])("%i → %s", (n, attendu) => {
    expect(nombreEnLettres(n)).toBe(attendu);
  });

  it("refuse un nombre négatif, décimal ou supérieur à 999 999 999", () => {
    expect(() => nombreEnLettres(-1)).toThrow();
    expect(() => nombreEnLettres(1.5)).toThrow();
    expect(() => nombreEnLettres(1_000_000_000)).toThrow();
  });
});

describe("montantEnLettres", () => {
  it("zéro euro et un euro, au singulier", () => {
    expect(montantEnLettres(0)).toBe("zéro euro");
    expect(montantEnLettres(euros(1))).toBe("un euro");
  });

  it("pluriel des euros dès deux", () => {
    expect(montantEnLettres(euros(2))).toBe("deux euros");
    expect(montantEnLettres(euros(80))).toBe("quatre-vingts euros");
    expect(montantEnLettres(euros(201))).toBe("deux-cent-un euros");
  });

  it("centimes seuls, au singulier et au pluriel", () => {
    expect(montantEnLettres(1)).toBe("un centime");
    expect(montantEnLettres(50)).toBe("cinquante centimes");
    expect(montantEnLettres(99)).toBe("quatre-vingt-dix-neuf centimes");
  });

  it("euros et centimes", () => {
    expect(montantEnLettres(23150)).toBe("deux-cent-trente-et-un euros et cinquante centimes");
    expect(montantEnLettres(101)).toBe("un euro et un centime");
    expect(montantEnLettres(8080)).toBe("quatre-vingts euros et quatre-vingts centimes");
  });

  it("« d'euros » après un nombre rond de millions seulement", () => {
    expect(montantEnLettres(euros(1_000_000))).toBe("un million d'euros");
    expect(montantEnLettres(euros(2_000_000))).toBe("deux millions d'euros");
    expect(montantEnLettres(euros(2_000_001))).toBe("deux millions un euros");
    expect(montantEnLettres(euros(1_000_000) + 50)).toBe("un million d'euros et cinquante centimes");
  });

  it("montants réels : 36 mois de loyer charges comprises", () => {
    // 650 € + 30 € de charges → 680 × 36 = 24 480 €
    expect(montantEnLettres(euros(24_480))).toBe("vingt-quatre-mille-quatre-cent-quatre-vingts euros");
    // 750 € + 50 € → 800 × 36 = 28 800 €
    expect(montantEnLettres(euros(28_800))).toBe("vingt-huit-mille-huit-cents euros");
    // 512,40 € + 47,35 € = 559,75 € → × 36 = 20 151 €
    expect(montantEnLettres(euros(20_151))).toBe("vingt-mille-cent-cinquante-et-un euros");
    // 433,33 € + 21,71 € = 455,04 € → × 36 = 16 381,44 €
    expect(montantEnLettres(1_638_144)).toBe("seize-mille-trois-cent-quatre-vingt-un euros et quarante-quatre centimes");
    // 1 990 € + 210 € = 2 200 € → × 36 = 79 200 €
    expect(montantEnLettres(euros(79_200))).toBe("soixante-dix-neuf-mille-deux-cents euros");
  });

  it("refuse un montant négatif ou non entier", () => {
    expect(() => montantEnLettres(-1)).toThrow();
    expect(() => montantEnLettres(10.5)).toThrow();
  });
});
