import { describe, expect, it } from "vitest";
import { splitUrlList } from "./config.ts";

describe("splitUrlList(カンマ区切りURLリスト)", () => {
  it("単一URLはそのまま1要素になる", () => {
    expect(splitUrlList("https://chouseisan.com/s?h=abc")).toEqual([
      "https://chouseisan.com/s?h=abc",
    ]);
  });

  it("カンマ区切りで複数URLに分解し、空白を除去する", () => {
    expect(
      splitUrlList(" https://chouseisan.com/s?h=a ,https://chouseisan.com/s?h=b,\nhttps://chouseisan.com/s?h=c "),
    ).toEqual([
      "https://chouseisan.com/s?h=a",
      "https://chouseisan.com/s?h=b",
      "https://chouseisan.com/s?h=c",
    ]);
  });

  it("空文字・空要素は除かれる(未設定は空配列)", () => {
    expect(splitUrlList("")).toEqual([]);
    expect(splitUrlList("a,,b,")).toEqual(["a", "b"]);
  });
});