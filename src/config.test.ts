import { describe, expect, it } from "vitest";
import { parseShopList, splitUrlList } from "./config.ts";

describe("splitUrlList(カンマ区切りURLリスト)", () => {
  it("カンマ区切りで分解し、空白と空要素を除去する", () => {
    expect(splitUrlList(" a , b,c,, ")).toEqual(["a", "b", "c"]);
    expect(splitUrlList("")).toEqual([]);
  });
});

describe("parseShopList(店舗リストの分解)", () => {
  it("id:表示名:キーワード 形式を分解する", () => {
    const shops = parseShopList("1047:蒲田個サル:チーム");
    expect(shops).toEqual([{ id: "1047", name: "蒲田個サル", keyword: "チーム" }]);
  });

  it("表示名のない要素は読み飛ばす(idだけでは指定できない)", () => {
    expect(parseShopList("3007")).toEqual([]);
  });

  it("複数店舗をコンマ区切りで指定できる", () => {
    const shops = parseShopList("1047:蒲田個サル:チーム,3007:カルチョ");
    expect(shops).toEqual([
      { id: "1047", name: "蒲田個サル", keyword: "チーム" },
      { id: "3007", name: "カルチョ", keyword: "" },
    ]);
  });

  it("表示名のない要素や数値でないIDは読み飛ばす", () => {
    expect(parseShopList("abc:名前,1047:蒲田個サル")).toEqual([
      { id: "1047", name: "蒲田個サル", keyword: "" },
    ]);
  });
});