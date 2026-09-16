// エントリポイント: LaBOLAの蒲田個サルを取得し、Googleカレンダーへ同期する
// 使い方:
//   npm run sync               … 実同期(認証情報が必要)
//   npm run sync -- --dry-run  … 取得結果の表示のみ(カレンダー不要)
//
// カレンダーは2つ書き込み可能:
//   GOOGLE_CALENDAR_ID             … フットサル(LaBOLA)のみのカレンダー
//   GOOGLE_CALENDAR_ATTENDANCE_ID  … 調整さんの出欠人数を説明欄に入れた版(任意)
//                                     CHOUSEISAN_URL が必要(カンマ区切りで複数URL可)

import { config } from "./config.ts";
import { fetchUpcomingEvents } from "./labola.ts";
import type { LabolaEvent } from "./types.ts";
import type { ChouseisanData, ChouseisanSlot } from "./chouseisan.ts";
import {
  fetchChouseisanAll,
  formatSlotLine,
  partitionUpcoming,
  slotsForDate,
} from "./chouseisan.ts";
import {
  getCalendarClient,
  formatTitle,
  upsertEvent,
  upsertStandaloneSlot,
  deleteVanishedEvents,
} from "./calendar.ts";

function printEvents(events: LabolaEvent[]) {
  for (const ev of events) {
    const cap = ev.current != null && ev.capacity != null ? `${ev.current}/${ev.capacity}` : "?";
    console.log(
      `${formatTitle(ev)}  [${ev.status}] 募集 ${cap}  ${ev.start}  ${ev.title}`,
    );
  }
}

/** 複数の出欠表(将来の日程を持つものだけ)をまとめた作業用ビュー */
export interface ChouseisanSource {
  data: ChouseisanData;
  /** 出欠表に回答した人数(全日程で出現した名前のユニーク数) */
  totalMembers: number;
}

export function toSource(data: ChouseisanData): ChouseisanSource {
  const totalMembers = new Set(
    data.slots.flatMap((s) => [...s.ok, ...s.maybe, ...s.no]),
  ).size;
  return { data, totalMembers };
}

/** 複数の出欠表のスロットを1つにまとめる(URL順) */
function mergedSlots(sources: ChouseisanSource[]): ChouseisanSlot[] {
  return sources.flatMap((src) => src.data.slots);
}

/** 出欠表のスロットを「カレンダーに載せる日程」に整理する(蒲田個サルに対応しない日程のみ) */
function collectStandalone(
  sources: ChouseisanSource[],
  events: LabolaEvent[],
): { src: ChouseisanSource; slot: ChouseisanSlot }[] {
  const eventDates = new Set(events.map((ev) => ev.start.slice(0, 10)));
  return sources.flatMap((src) =>
    src.data.slots
      .filter((s) => !eventDates.has(s.date))
      .map((slot) => ({ src, slot })),
  );
}

/**
 * 出欠付きカレンダーの説明欄に載せる出欠ブロック。
 * 複数の出欠表が同じ日付に候補を持つ場合は出欠表ごとにブロックを分ける。
 */
export function attendanceDescription(
  sources: ChouseisanSource[],
  date: string,
): string | undefined {
  const blocks: string[] = [];
  for (const src of sources) {
    const slots = slotsForDate(src.data.slots, date);
    if (slots.length === 0) continue;
    blocks.push(
      [
        `調整さん「${src.data.name}」(回答${src.totalMembers}名)`,
        ...slots.map(formatSlotLine),
      ].join("\n"),
    );
  }
  return blocks.length > 0 ? blocks.join("\n") : undefined;
}

/** ある日付の○人数(複数出欠表がある場合は最多のもの。タイトル用) */
function okCountForDate(sources: ChouseisanSource[], date: string): number | null {
  const counts = sources.flatMap((src) =>
    slotsForDate(src.data.slots, date).map((s) => s.ok.length),
  );
  return counts.length > 0 ? Math.max(...counts) : null;
}

/**
 * 出欠付きカレンダーに載せるべきイベントかどうか。
 * 調整さんの候補は「平日夜・土日は終日」なので、平日日中(17:30開始より前)の
 * イベントは出欠カレンダーの対象から外す(土日・日曜は時間不問)。
 */
export function isAttendedCalendarCandidate(start: string): boolean {
  // start: "2026-09-18T13:00:00+09:00" 形式(全てJST固定)
  const time = start.slice(11, 16);
  const [y, mo, d] = start.slice(0, 10).split("-");
  const dow = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay();
  // 0=日 6=土
  return dow === 0 || dow === 6 || time >= "17:30";
}

/** 出欠が付いた日付(イベントの開始日)ごとのスロット一覧 */
function attendanceByDate(
  slots: ChouseisanSlot[],
  events: LabolaEvent[],
): Map<string, ChouseisanSlot[]> {
  const eventDates = new Set(events.map((ev) => ev.start.slice(0, 10)));
  const map = new Map<string, ChouseisanSlot[]>();
  for (const slot of slots) {
    if (!eventDates.has(slot.date)) continue;
    const list = map.get(slot.date) ?? [];
    list.push(slot);
    map.set(slot.date, list);
  }
  return map;
}

/** 出欠付きカレンダー用のコンパクトなタイトル(日時はカレンダー自身が持つため省略) */
function attendanceTitle(ev: LabolaEvent, okCount: number | null): string {
  const remaining = ev.current != null && ev.capacity != null ? ev.capacity - ev.current : null;
  const state =
    ev.status !== "open"
      ? `×${ev.status === "full" ? "満席" : "受付終了"}`
      : remaining != null && remaining <= config.lowSeatsThreshold
        ? "△残りわずか"
        : "○募集中";
  return okCount != null ? `${state} 蒲田 / 調整${okCount}名○` : `${state} 蒲田`;
}

/** 現在時刻のJST ISO文字列(dayOffsetMsだけ未来にずらせる) */
function jstIso(dayOffsetMs = 0): string {
  return new Date(Date.now() + dayOffsetMs + 9 * 3600 * 1000)
    .toISOString()
    .replace("Z", "+09:00");
}

/** 同期範囲の上限(syncDays日後)のJST ISO文字列 */
function horizonIso(): string {
  return jstIso((config.syncDays + 1) * 24 * 3600 * 1000);
}

async function syncCalendar(
  cal: ReturnType<typeof getCalendarClient>,
  calendarId: string,
  label: string,
  events: LabolaEvent[],
  getOpts?: (ev: LabolaEvent) => { title?: string; extraDescription?: string } | undefined,
  extraKeep?: { key: string; ids: Set<string> },
) {
  const counts = { created: 0, updated: 0, unchanged: 0 };
  for (const ev of events) {
    const result = await upsertEvent(cal, calendarId, ev, getOpts?.(ev));
    counts[result]++;
  }
  console.log(
    `[${label}] カレンダー同期: 新規${counts.created} 更新${counts.updated} 変更なし${counts.unchanged}`,
  );
  const deleted = await deleteVanishedEvents(cal, calendarId, events, extraKeep);
  if (deleted.length > 0) {
    console.log(`[${label}] 削除(サイトから消えたイベント): ${deleted.length}件`);
    for (const d of deleted) console.log(`  - ${d}`);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `shop=${config.shopId} syncDays=${config.syncDays} keyword="${config.fetchKeyword}" dryRun=${dryRun}`,
  );
  const useAttendance = Boolean(config.attendanceCalendarId);
  if (useAttendance && config.chouseisanUrls.length === 0) {
    throw new Error(
      "GOOGLE_CALENDAR_ATTENDANCE_ID を設定した場合は CHOUSEISAN_URL も必要です(カンマ区切りで複数可)",
    );
  }

  const events = await fetchUpcomingEvents({
    shopId: config.shopId,
    syncDays: config.syncDays,
    keyword: config.fetchKeyword,
    requestIntervalMs: config.requestIntervalMs,
  });
  console.log(`取得イベント数: ${events.length}`);
  printEvents(events);
  if (dryRun) {
    if (config.chouseisanUrls.length > 0) {
      for (const chouseisan of await fetchChouseisanAll(config.chouseisanUrls, config.requestIntervalMs)) {
        console.log(
          `調整さん「${chouseisan.name}」: 日程${chouseisan.slots.length}件`,
        );
        for (const slot of chouseisan.slots) {
          console.log(`  ${formatSlotLine(slot)}`);
        }
        console.log(
          `  → 蒲田個サルと同じ日付: ${chouseisan.slots.filter((s) => events.some((ev) => ev.start.slice(0, 10) === s.date)).length}件 / 単独日程: ${chouseisan.slots.filter((s) => !events.some((ev) => ev.start.slice(0, 10) === s.date)).length}件`,
        );
      }
    }
    console.log("--dry-run のためカレンダー操作は行いません");
    return;
  }

  if (!config.calendarId || !config.saKey) {
    throw new Error("GOOGLE_CALENDAR_ID と GCP_SA_KEY を設定してください(Secrets または .dev.env)");
  }
  const cal = getCalendarClient();

  // 1) フットサルのみのカレンダー
  await syncCalendar(cal, config.calendarId, "フットサルのみ", events);

  // 2) 調整さんの出欠人数も入れた版
  if (useAttendance) {
    const fetched = await fetchChouseisanAll(config.chouseisanUrls, config.requestIntervalMs);
    // 未来の日程が1つもない古い出欠表は自動的に除外する(消し忘れても害なし)
    const { upcoming, expired } = partitionUpcoming(fetched, new Date());
    for (const old of expired) {
      console.log(`調整さん「${old.name}」: 未来の日程がないためスキップします`);
    }
    const sources = upcoming.map(toSource);
    for (const src of sources) {
      console.log(
        `調整さん「${src.data.name}」: 日程${src.data.slots.length}件 回答${src.totalMembers}名`,
      );
    }
    const standalonePairs = collectStandalone(sources, events);
    const standaloneSlots = standalonePairs.filter(
      ({ slot }) => slot.date >= jstIso().slice(0, 10) && slot.date <= horizonIso().slice(0, 10),
    );
    // 出欠付きカレンダーには「調整さんの候補と重なる日」のイベントだけを載せる
    // (平日日中は調整の対象外なので、平日は17:30開始以降のみ)
    const attendedEvents = events.filter(
      (ev) =>
        isAttendedCalendarCandidate(ev.start) &&
        slotsForDate(mergedSlots(sources), ev.start.slice(0, 10)).length > 0,
    );
    // 日付ごとに1行だけ集計をログする
    for (const [date, slots] of attendanceByDate(mergedSlots(sources), events)) {
      console.log(
        `  出欠 ${date}: ${slots.map((s) => `${s.label} ○${s.ok.length}/△${s.maybe.length}`).join(", ")}`,
      );
    }

    await syncCalendar(
      cal,
      config.attendanceCalendarId,
      "調整さん人数入り",
      attendedEvents,
      (ev) => ({
        title: attendanceTitle(ev, okCountForDate(sources, ev.start.slice(0, 10))),
        extraDescription: attendanceDescription(sources, ev.start.slice(0, 10)),
      }),
      {
        key: "chouseisanId",
        // 削除判定の keep は「対象期間内の単独日程」のみでよいが、URLをまたいで
        // 全出欠表のスロットIDを渡して誤削除を防ぐ
        ids: new Set(standalonePairs.map(({ src, slot }) => `${src.data.id}:${slot.num}`)),
      },
    );
    const slotCounts = { created: 0, updated: 0, unchanged: 0 };
    for (const { src, slot } of standaloneSlots) {
      const r = await upsertStandaloneSlot(
        cal,
        config.attendanceCalendarId,
        slot,
        src.data,
        src.totalMembers,
      );
      slotCounts[r]++;
    }
    console.log(
      `[調整さん単独日程] 全天候イベント: 新規${slotCounts.created} 更新${slotCounts.updated} 変更なし${slotCounts.unchanged}`,
    );
  }

  console.log("完了");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});