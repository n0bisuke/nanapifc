// エントリポイント: LaBOLAの蒲田個サルを取得し、Googleカレンダーへ同期する
// 使い方:
//   npm run sync               … 実同期(認証情報が必要)
//   npm run sync -- --dry-run  … 取得結果の表示のみ(カレンダー不要)
//
// カレンダーは2つ書き込み可能:
//   GOOGLE_CALENDAR_ID             … フットサル(LaBOLA)のみのカレンダー
//   GOOGLE_CALENDAR_ATTENDANCE_ID  … 調整さんの出欠人数を説明欄に入れた版(任意)
//                                     CHOUSEISAN_URL が必要

import { config } from "./config.ts";
import { fetchUpcomingEvents } from "./labola.ts";
import type { LabolaEvent } from "./types.ts";
import type { ChouseisanSlot } from "./chouseisan.ts";
import { fetchChouseisan, formatSlotLine, slotsForDate } from "./chouseisan.ts";
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

/** 出欠表のスロットを「カレンダーに載せる日程」に整理する */
function collectAttendance(
  chouseisan: { id: string; name: string; slots: ChouseisanSlot[] },
  events: LabolaEvent[],
) {
  const eventDates = new Set(events.map((ev) => ev.start.slice(0, 10)));
  const matched = events.map((ev) => ({
    ev,
    slots: slotsForDate(chouseisan.slots, ev.start.slice(0, 10)),
  }));
  // 蒲田個サルのイベントに対応しない日程 → 全天候イベントとして載せる
  const standalone = chouseisan.slots.filter((s) => !eventDates.has(s.date));
  return { matched, standalone };
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
  if (useAttendance && !config.chouseisanUrl) {
    throw new Error("GOOGLE_CALENDAR_ATTENDANCE_ID を設定した場合は CHOUSEISAN_URL も必要です");
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
    if (config.chouseisanUrl) {
      const chouseisan = await fetchChouseisan(config.chouseisanUrl);
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
    const chouseisan = await fetchChouseisan(config.chouseisanUrl);
    const totalMembers = new Set(
      chouseisan.slots.flatMap((s) => [...s.ok, ...s.maybe, ...s.no]),
    ).size;
    console.log(
      `調整さん「${chouseisan.name}」: 日程${chouseisan.slots.length}件 回答${totalMembers}名`,
    );
    const { standalone } = collectAttendance(chouseisan, events);
    // 日付ごとに1行だけ集計をログする
    for (const [date, slots] of attendanceByDate(chouseisan.slots, events)) {
      console.log(
        `  出欠 ${date}: ${slots.map((s) => `${s.label} ○${s.ok.length}/△${s.maybe.length}`).join(", ")}`,
      );
    }

    const now = new Date();
    const nowIso = new Date(now.getTime() + 9 * 3600 * 1000)
      .toISOString()
      .replace("Z", "+09:00");
    const horizonIso = new Date(now.getTime() + (config.syncDays + 1) * 24 * 3600 * 1000 + 9 * 3600 * 1000)
      .toISOString()
      .replace("Z", "+09:00");
    const standaloneSlots = standalone.filter(
      (s) => s.date >= nowIso.slice(0, 10) && s.date <= horizonIso.slice(0, 10),
    );
    const keepIds = new Set(standaloneSlots.map((s) => `${chouseisan.id}:${s.num}`));

    await syncCalendar(
      cal,
      config.attendanceCalendarId,
      "調整さん人数入り",
      events,
      (ev) => {
        const slots = slotsForDate(chouseisan.slots, ev.start.slice(0, 10));
        return {
          title: attendanceTitle(ev, slots[0]?.ok.length ?? null),
          extraDescription:
            slots.length === 0
              ? undefined
              : [
                  `調整さん「${chouseisan.name}」(回答${totalMembers}名)`,
                  ...slots.map(formatSlotLine),
                ].join("\n"),
        };
      },
      { key: "chouseisanId", ids: keepIds },
    );
    const slotCounts = { created: 0, updated: 0, unchanged: 0 };
    for (const slot of standaloneSlots) {
      const r = await upsertStandaloneSlot(
        cal,
        config.attendanceCalendarId,
        slot,
        chouseisan,
        totalMembers,
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