import { describe, expect, it } from "vitest";
import { isAttendedCalendarCandidate } from "./index.ts";

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