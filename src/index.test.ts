import { describe, expect, it } from "vitest";
import {
  attendanceDescription,
  isAttendedCalendarCandidate,
  toSource,
  type ChouseisanSource,
} from "./index.ts";
import type { ChouseisanData } from "./chouseisan.ts";

function makeData(name: string, dates: { num: number; date: string; ok: string[] }[]): ChouseisanData {
  return {
    id: `${name}-id`,
    name,
    deadlined: false,
    slots: dates.map((d) => ({
      num: d.num,
      label: d.date,
      date: d.date,
      time: null,
      ok: d.ok,
      maybe: [],
      no: [],
    })),
  };
}

describe("isAttendedCalendarCandidate(出欠カレンダーの対象判定)", () => {
  it("平日の17:30以降は対象", () => {
    expect(isAttendedCalendarCandidate("2026-09-18T17:30:00+09:00")).toBe(true); // 金
    expect(isAttendedCalendarCandidate("2026-09-18T19:30:00+09:00")).toBe(true); // 金
    expect(isAttendedCalendarCandidate("2026-09-18T21:30:00+09:00")).toBe(true); // 金
  });

  it("平日の日中(17:30より前)は対象外", () => {
    expect(isAttendedCalendarCandidate("2026-09-18T13:00:00+09:00")).toBe(false); // 金 昼
    expect(isAttendedCalendarCandidate("2026-09-14T08:30:00+09:00")).toBe(false); // 月 朝
    expect(isAttendedCalendarCandidate("2026-09-15T17:00:00+09:00")).toBe(false); // 火 17:00
  });

  it("土日は時間不問で対象", () => {
    expect(isAttendedCalendarCandidate("2026-09-19T08:30:00+09:00")).toBe(true); // 土 朝
    expect(isAttendedCalendarCandidate("2026-09-20T10:30:00+09:00")).toBe(true); // 日 午前
  });

  it("17:30ちょうどは対象", () => {
    expect(isAttendedCalendarCandidate("2026-09-18T17:30:00+09:00")).toBe(true);
  });
});

describe("attendanceDescription(複数出欠表の説明ブロック)", () => {
  const sept: ChouseisanSource = toSource(
    makeData("9月", [{ num: 1, date: "2026-09-26", ok: ["メンバー1", "メンバー2"] }]),
  );
  const oct: ChouseisanSource = toSource(
    makeData("10月", [{ num: 1, date: "2026-09-26", ok: ["メンバー3"] }]),
  );

  it("単一出欠表は従来と同じ形式になる", () => {
    expect(attendanceDescription([sept], "2026-09-26")).toBe(
      "調整さん「9月」(回答2名)\n2026-09-26: ○2/△0/×0 … メンバー1, メンバー2",
    );
  });

  it("同じ日付に複数の出欠表が候補を持つ場合は出欠表ごとにブロックを分ける", () => {
    expect(attendanceDescription([sept, oct], "2026-09-26")).toBe(
      "調整さん「9月」(回答2名)\n" +
        "2026-09-26: ○2/△0/×0 … メンバー1, メンバー2\n" +
        "調整さん「10月」(回答1名)\n" +
        "2026-09-26: ○1/△0/×0 … メンバー3",
    );
  });

  it("候補がない出欠表のブロックは入らない", () => {
    expect(attendanceDescription([oct], "2026-09-27")).toBeUndefined();
    expect(attendanceDescription([sept, oct], "2026-09-27")).toBeUndefined();
  });

  it("回答人数は全日程のユニーク回答者数", () => {
    const two = toSource(
      makeData("9月", [
        { num: 1, date: "2026-09-26", ok: ["A"] },
        { num: 2, date: "2026-09-27", ok: ["A", "B"] },
      ]),
    );
    expect(two.totalMembers).toBe(2);
    expect(attendanceDescription([two], "2026-09-27")).toContain("(回答2名)");
  });
});