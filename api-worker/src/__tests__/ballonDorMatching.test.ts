import { describe, expect, it } from "vitest";
import { matchByName, nameTokens } from "../ballonDorMatching";

const pair = (name: string): [string, string] => [name, name];

describe("matchByName — клубы", () => {
  it("находит клуб под провайдерским именем с приставкой", () => {
    const teams = [pair("FC Barcelona"), pair("Chelsea FC"), pair("FC Bayern München")];
    expect(matchByName("Barcelona", teams)).toEqual({ kind: "loose", value: "FC Barcelona" });
    expect(matchByName("Chelsea", teams)).toEqual({ kind: "loose", value: "Chelsea FC" });
    expect(matchByName("Bayern München", teams)).toEqual({ kind: "loose", value: "FC Bayern München" });
  });

  it("точное совпадение выигрывает у нестрогого", () => {
    const teams = [pair("Arsenal FC"), pair("Arsenal")];
    expect(matchByName("Arsenal", teams)).toEqual({ kind: "exact", value: "Arsenal" });
  });

  it("не путает Inter с Internazionale — границы по словам, а не подстрока", () => {
    expect(matchByName("Inter", [pair("Internazionale")])).toEqual({ kind: "none" });
  });

  it("«Inter Miami» не сваливается в миланский «Inter»", () => {
    // Односложный кандидат не должен проглатывать длинный запрос: иначе enrich
    // ушёл бы за ростером не того клуба.
    expect(matchByName("Inter Miami", [pair("Inter")])).toEqual({ kind: "none" });
  });

  it("многословный кандидат короче запроса всё ещё находится", () => {
    expect(matchByName("Bayern München Munich", [pair("Bayern München")]))
      .toEqual({ kind: "loose", value: "Bayern München" });
  });

  it("два подходящих клуба возвращаются как неоднозначность", () => {
    const res = matchByName("Inter", [pair("Inter Milan"), pair("Inter Miami")]);
    expect(res.kind).toBe("ambiguous");
    if (res.kind === "ambiguous") expect(res.candidates).toHaveLength(2);
  });
});

describe("matchByName — игроки", () => {
  it("находит игрока по полному имени провайдера", () => {
    const roster = [pair("Vinicius Jose Paixao de Oliveira Junior"), pair("Kylian Mbappe")];
    expect(matchByName("Vinícius Júnior", roster))
      .toEqual({ kind: "loose", value: "Vinicius Jose Paixao de Oliveira Junior" });
  });

  it("диакритика не мешает точному совпадению", () => {
    expect(matchByName("Ousmane Dembélé", [pair("Ousmane Dembele")]))
      .toEqual({ kind: "exact", value: "Ousmane Dembele" });
  });

  it("«Gabriel» в Арсенале честно возвращает неоднозначность, а не первого", () => {
    const roster = [pair("Gabriel Magalhaes"), pair("Gabriel Jesus"), pair("Gabriel Martinelli")];
    const res = matchByName("Gabriel", roster);
    expect(res.kind).toBe("ambiguous");
    if (res.kind === "ambiguous") expect(res.candidates).toHaveLength(3);
  });

  it("пустой запрос и пустой список не падают", () => {
    expect(matchByName("", [pair("Rodri")])).toEqual({ kind: "none" });
    expect(matchByName("Rodri", [])).toEqual({ kind: "none" });
  });
});

describe("nameTokens", () => {
  it("режет по словам и снимает диакритику", () => {
    expect(nameTokens("Lautaro Martínez")).toEqual(["lautaro", "martinez"]);
    expect(nameTokens("  ")).toEqual([]);
  });
});
