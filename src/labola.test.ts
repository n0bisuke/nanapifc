import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseDateTime,
  parseCapacity,
  normalizeStatus,
  parseEventList,
  buildEventListUrl,
} from "./labola.ts";

const fixture = readFileSync(
  fileURLToPath(new URL("./__fixtures__/event_list_sample.html", import.meta.url)),
  "utf8",
);

describe("parseDateTime", () => {
  it("通常のイベント日時をJST ISOに変換する", () => {
    const dt = parseDateTime("2026/09/18（金）13:00〜14:30");
    expect(dt).toEqual({
      start: "2026-09-18T13:00:00+09:00",
      end: "2026-09-18T14:30:00+09:00",
    });
  });

  it("半角記号(〜なし/ハイフン)にも対応する", () => {
    expect(parseDateTime("2026/01/02（木）9:00-11:00")?.start).toBe("2026-01-02T09:00:00+09:00");
  });

  it("深夜イベントは終了が翌日になる", () => {
    const dt = parseDateTime("2026/09/18（金）23:00〜01:00");
    expect(dt?.end).toBe("2026-09-19T01:00:00+09:00");
  });

  it("パースできない場合はnullを返す", () => {
    expect(parseDateTime("日程未定")).toBeNull();
  });
});

describe("parseCapacity", () => {
  it("全角スラッシュを扱う", () => {
    expect(parseCapacity("募集数 11／15")).toEqual({ current: 11, capacity: 15 });
  });
  it("半角スラッシュにも対応する", () => {
    expect(parseCapacity("募集数 0/15")).toEqual({ current: 0, capacity: 15 });
  });
  it("数字がない場合はnullを返す", () => {
    expect(parseCapacity("募集数 -")).toEqual({ current: null, capacity: null });
  });
});

describe("normalizeStatus", () => {
  it("満席・受付終了・受付け中を正規化する", () => {
    expect(normalizeStatus("受付け中")).toBe("open");
    expect(normalizeStatus("満席")).toBe("full");
    expect(normalizeStatus("受付け終了")).toBe("closed");
    expect(normalizeStatus("受付締切")).toBe("closed");
  });
});

describe("parseEventList", () => {
  const events = parseEventList(fixtureHtml(), "1047");

  function fixtureHtml(): string {
    // フィクスチャは<li>の連結なので、一覧ページと同じ構造にラップする
    return `<ul>${fixture}</ul>`;
  }

  it("実サイトのHTMLから全カードをパースする", () => {
    expect(events.length).toBe(20);
  });

  it("基本項目(日時・タイトル・募集数・URL)が正しく取れる", () => {
    const first = events[0];
    expect(first).toBeDefined();
    expect(first?.labolaId).toBeTruthy();
    expect(first?.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/);
    expect(first?.title).not.toBe("");
    expect(first?.url).toContain(`/r/shop/1047/event/show/${first?.labolaId}/`);
    expect(first?.current).not.toBeNull();
    expect(first?.capacity).not.toBeNull();
  });

  it("満席イベントがfullになる", () => {
    const full = events.find((ev) => ev.status === "full");
    expect(full).toBeDefined();
    expect(full?.current).toBe(full?.capacity);
  });

  it("labolaIdで重複排除される", () => {
    const ids = events.map((ev) => ev.labolaId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildEventListUrl", () => {
  it("日付指定・キーワード付きURLを組み立てる", () => {
    const url = buildEventListUrl("1047", "2026-09-16", "チーム");
    expect(url).toBe(
      "https://yoyaku.labola.jp/r/shop/1047/event/individual/?hold_on_at=2026-09-16&category=&kind=individual&accept_class=&keyword=%E3%83%81%E3%83%BC%E3%83%A0",
    );
  });
});