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
    expect(shops).toEqual([{ id: "1047", name: "蒲田個サル", keyword: "チーム", venues: [] }]);
  });

  it("表示名のない要素は読み飛ばす(idだけでは指定できない)", () => {
    expect(parseShopList("3007")).toEqual([]);
  });

  it("会場フィルタのみでキーワードなしの指定もできる", () => {
    const shop = parseShopList("3007:カルチョ::代々木")[0];
    expect(shop?.keyword).toBe("");
    expect(shop?.venues).toEqual(["代々木"]);
  });

  it("複数店舗をコンマ区切りで指定できる", () => {
    const shops = parseShopList("1047:蒲田個サル:チーム,3007:カルチョ");
    expect(shops).toEqual([
      { id: "1047", name: "蒲田個サル", keyword: "チーム", venues: [] },
      { id: "3007", name: "カルチョ", keyword: "", venues: [] },
    ]);
  });

  it("会場フィルタ(4つ目のフィールド)を「/」区切りで指定できる", () => {
    const shops = parseShopList(
      "1047:蒲田個サル:チーム,3007:カルチョ::すみだフットサルアリーナ/代々木競技場",
    );
    expect(shops).toEqual([
      { id: "1047", name: "蒲田個サル", keyword: "チーム", venues: [] },
      {
        id: "3007",
        name: "カルチョ",
        keyword: "",
        venues: ["すみだフットサルアリーナ", "代々木競技場"],
      },
    ]);
  });

  it("表示名のない要素や数値でないIDは読み飛ばす", () => {
    expect(parseShopList("abc:名前,1047:蒲田個サル")).toEqual([
      { id: "1047", name: "蒲田個サル", keyword: "", venues: [] },
    ]);
  });
});