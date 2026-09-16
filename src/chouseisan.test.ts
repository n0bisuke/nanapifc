import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  extractChouseisanJson,
  parseChouseisan,
  parseSlotLabel,
  slotsForDate,
  formatSlotLine,
  partitionUpcoming,
  type ChouseisanData,
} from "./chouseisan.ts";

const fixture = readFileSync(
  fileURLToPath(new URL("./__fixtures__/chouseisan_sample.html", import.meta.url)),
  "utf8",
);

const NOW = new Date("2026-09-15T00:00:00+09:00");

describe("parseSlotLabel", () => {
  it("日付+時刻を分解する", () => {
    expect(parseSlotLabel("9/26(土) 19:00〜", NOW)).toEqual({
      date: "2026-09-26",
      time: "19:00〜",
    });
  });

  it("時刻なし・曖昧な表記でも日付は取れる", () => {
    expect(parseSlotLabel("9/27(日)", NOW)).toEqual({ date: "2026-09-27", time: null });
    expect(parseSlotLabel("9/26(土) 昼~夕方頃", NOW)).toEqual({
      date: "2026-09-26",
      time: null,
    });
  });

  it("年跨ぎの日程は現在に最も近い年を選ぶ", () => {
    const jan = new Date("2027-01-05T00:00:00+09:00");
    expect(parseSlotLabel("12/28(月) 19:00〜", jan)?.date).toBe("2026-12-28");
  });

  it("日付を含まないラベルはnullを返す", () => {
    expect(parseSlotLabel("未定", NOW)).toBeNull();
  });
});

describe("parseChouseisan", () => {
  const json = extractChouseisanJson(fixture);
  it("実ページからwindow.Chouseisan JSONを取り出せる", () => {
    expect(json).not.toBeNull();
    // HTML側は \uXXXX エスケープなので、パース後のnameで確認する
    expect(json).toContain("nanapi");
  });

  if (!json) throw new Error("fixture broken");
  const data = parseChouseisan(json, NOW);

  it("タイトルと日程数が正しい", () => {
    expect(data.name).toBe("nanapi 9月~10月上旬");
    expect(data.slots.length).toBe(22);
  });

  it("出欠集計(○△×)が正しい", () => {
    // 実データ: 9/14(月) 19:00〜 は ○4/△2
    const slot = data.slots.find((s) => s.label.startsWith("9/14"));
    expect(slot?.ok.length).toBe(4);
    expect(slot?.maybe.length).toBe(2);
    expect(slot?.ok).toContain("メンバー1");
  });

  it("無回答スロットは全員×に集計される(0/0)", () => {
    const slot = data.slots.find((s) => s.label.startsWith("10/7"));
    expect(slot?.ok.length).toBe(0);
    expect(slot?.maybe.length).toBe(0);
  });

  it("日付でスロットを引ける", () => {
    const slots = slotsForDate(data.slots, "2026-09-24");
    expect(slots.length).toBe(1);
    expect(slots[0]?.label.startsWith("9/24")).toBe(true);
  });

  it("説明行に人数と名前が入る", () => {
    const slot = data.slots.find((s) => s.label.startsWith("9/14"))!;
    const line = formatSlotLine(slot);
    expect(line).toContain("○4/△2/×6");
    expect(line).toContain("メンバー1");
  });
});

describe("partitionUpcoming(未来日程のない古い出欠表の除外)", () => {
  const make = (dates: string[], name = "テスト"): ChouseisanData => ({
    id: "test",
    name,
    deadlined: false,
    slots: dates.map((date, i) => ({
      num: i + 1,
      label: date,
      date,
      time: null,
      ok: [],
      maybe: [],
      no: [],
    })),
  });

  it("未来の日程を持つ出欠表は残る(当日を含む)", () => {
    const { upcoming, expired } = partitionUpcoming(
      [make(["2026-09-15", "2026-09-20"])],
      NOW,
    );
    expect(upcoming.length).toBe(1);
    expect(expired.length).toBe(0);
  });

  it("日程がすべて過去の出欠表は除外される", () => {
    const { upcoming, expired } = partitionUpcoming(
      [make(["2026-09-01", "2026-09-14"])],
      NOW,
    );
    expect(upcoming.length).toBe(0);
    expect(expired.length).toBe(1);
  });

  it("日程が空の出欠表も除外される", () => {
    const { upcoming, expired } = partitionUpcoming([make([])], NOW);
    expect(upcoming.length).toBe(0);
    expect(expired.length).toBe(1);
  });

  it("未来ありと過去のみを混在して振り分けられる", () => {
    const { upcoming, expired } = partitionUpcoming(
      [make(["2026-09-01"], "古い"), make(["2026-10-01"], "新しい")],
      NOW,
    );
    expect(upcoming.map((d) => d.name)).toEqual(["新しい"]);
    expect(expired.map((d) => d.name)).toEqual(["古い"]);
  });
});