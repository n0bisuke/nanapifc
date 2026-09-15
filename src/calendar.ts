// Google Calendar API ラッパ(サービスアカウント認証)
// 冪等キー: extendedProperties.private.labolaId で既存イベントを特定する

import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";
import type { LabolaEvent } from "./types.ts";
import type { ChouseisanSlot } from "./chouseisan.ts";
import { formatSlotLine } from "./chouseisan.ts";
import { config } from "./config.ts";

const LABOLA_KEY = "labolaId";
const CHOUSEISAN_KEY = "chouseisanId";

/** 秘密鍵JSON(base64 or 生JSON)をパースする */
function parseSaKey(saKey: string): { client_email: string; private_key: string } {
  const json = saKey.trim().startsWith("{") ? saKey : Buffer.from(saKey, "base64").toString("utf8");
  const creds = JSON.parse(json);
  if (!creds.client_email || !creds.private_key) {
    throw new Error("GCP_SA_KEY に client_email / private_key がありません");
  }
  return creds;
}

export function getCalendarClient(): calendar_v3.Calendar {
  const creds = parseSaKey(config.saKey);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

/** JST表記のユーティリティ */
function jstParts(iso: string): { date: string; time: string } {
  const dt = new Date(iso);
  const j = new Date(dt.getTime() + 9 * 3600 * 1000).toISOString();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const weekday = weekdays[new Date(j).getUTCDay()] ?? "";
  const ymd = j.slice(0, 10);
  const mo = ymd.slice(5, 7);
  const d = ymd.slice(8, 10);
  return { date: `${Number(mo)}/${Number(d)}(${weekday})`, time: j.slice(11, 16) };
}

export function formatTitle(ev: LabolaEvent): string {
  const p = jstParts(ev.start);
  // タイトル先頭の状況マーク: ×=満席・受付終了 / △=残りわずか / ○=空きあり
  const remaining = ev.current != null && ev.capacity != null ? ev.capacity - ev.current : null;
  const symbol =
    ev.status !== "open"
      ? "×"
      : remaining != null && remaining <= config.lowSeatsThreshold
        ? "△"
        : "○";
  const suffix =
    ev.status === "full"
      ? "満席"
      : ev.status === "closed"
        ? "受付終了"
        : remaining != null
          ? `残${remaining}名`
          : "受付中";
  return `${symbol}蒲田個サル ${p.date}${p.time}〜 ${suffix}`;
}

export function formatDescription(ev: LabolaEvent): string {
  const lines = [
    ev.title,
    `レベル: ${ev.level || "-"}`,
    `料金: ${ev.price || "-"}`,
    `募集: ${ev.current ?? "?"}/${ev.capacity ?? "?"}`,
    ev.deadlineNote ? `期限: ${ev.deadlineNote}` : "",
    `予約: ${ev.url}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** 「最終更新」行(必ず説明の末尾に置く) */
function updatedStamp(): string {
  const updated = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16);
  return `最終更新: ${updated} JST`;
}

/** 比較用に「最終更新」行を除いた説明を返す(タイムスタンプは毎回変わるため) */
function stripStamp(description: string): string {
  return description.replace(/\n最終更新: [^\n]*$/, "");
}

function eventBody(
  ev: LabolaEvent,
  opts?: { title?: string; extraDescription?: string },
): calendar_v3.Schema$Event {
  // 「最終更新」は必ず末尾に置く(冪等判定で stripStamp が末尾除去する前提)
  const description = [formatDescription(ev), opts?.extraDescription, updatedStamp()]
    .filter(Boolean)
    .join("\n\n");
  return {
    summary: opts?.title ?? formatTitle(ev),
    description,
    start: { dateTime: ev.start, timeZone: config.timeZone },
    end: { dateTime: ev.end, timeZone: config.timeZone },
    location: "銀座deフットサル 蒲田スタジアム(東京都大田区蒲田)",
    source: { title: "LaBOLA予約ページ", url: ev.url },
    extendedProperties: { private: { [LABOLA_KEY]: ev.labolaId } },
    reminders: { useDefault: false },
  };
}

/** 調整さんにしかない日程の全天候イベント(例: 蒲田以外の練習・飲み会候補) */
export function standaloneSlotBody(
  slot: ChouseisanSlot,
  data: { id: string; name: string },
  totalMembers: number,
): calendar_v3.Schema$Event {
  return {
    summary: `フットサル候補(調整さん) ${slot.label} ○${slot.ok.length}/△${slot.maybe.length}`,
    description: [
      `調整さん「${data.name}」(回答${totalMembers}名)より`,
      `この日程は蒲田個サルのカレンダーに対応するイベントがありません。`,
      "",
      formatSlotLine(slot),
      "",
      `最終更新: ${new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16)} JST`,
    ].join("\n"),
    start: { date: slot.date },
    end: { date: slot.date },
    extendedProperties: {
      private: { [CHOUSEISAN_KEY]: `${data.id}:${slot.num}` },
    },
    reminders: { useDefault: false },
  };
}

/** 既存イベントを拡張プロパティで検索する(なければ null) */
async function findExisting(
  cal: calendar_v3.Calendar,
  calendarId: string,
  key: string,
  value: string,
) {
  const res = await cal.events.list({
    calendarId,
    // APIの指定形式は property_name=value(コロンではなくイコール)
    privateExtendedProperty: [`${key}=${value}`],
    maxResults: 10,
    showDeleted: false,
  });
  const item = res.data.items?.[0];
  return item && item.id ? item : null;
}

/** 1イベントをupsertする。戻り値は "created" | "updated" | "unchanged" */
export async function upsertEvent(
  cal: calendar_v3.Calendar,
  calendarId: string,
  ev: LabolaEvent,
  opts?: { title?: string; extraDescription?: string },
) {
  const existing = await findExisting(cal, calendarId, LABOLA_KEY, ev.labolaId);
  const body = eventBody(ev, opts);
  if (existing) {
    const changed =
      existing.summary !== body.summary ||
      stripStamp(existing.description ?? "") !== stripStamp(body.description ?? "");
    if (!changed) return "unchanged";
    await cal.events.patch({
      calendarId,
      eventId: existing.id ?? undefined,
      requestBody: { summary: body.summary, description: body.description },
    });
    return "updated";
  }
  await cal.events.insert({ calendarId, requestBody: body });
  return "created";
}

/** 調整さん単独日程の全天候イベントをupsertする */
export async function upsertStandaloneSlot(
  cal: calendar_v3.Calendar,
  calendarId: string,
  slot: ChouseisanSlot,
  data: { id: string; name: string },
  totalMembers: number,
) {
  const key = `${data.id}:${slot.num}`;
  const existing = await findExisting(cal, calendarId, CHOUSEISAN_KEY, key);
  const body = standaloneSlotBody(slot, data, totalMembers);
  if (existing) {
    const changed =
      existing.summary !== body.summary ||
      stripStamp(existing.description ?? "") !== stripStamp(body.description ?? "");
    if (!changed) return "unchanged";
    await cal.events.patch({
      calendarId,
      eventId: existing.id ?? undefined,
      requestBody: { summary: body.summary, description: body.description },
    });
    return "updated";
  }
  await cal.events.insert({ calendarId, requestBody: body });
  return "created";
}

/**
 * サイトから消えた(キャンセルされた)今後のイベントをカレンダーから削除する。
 * このツールが付けた拡張プロパティを持つイベントのみ対象とする(他の予定には触れない)。
 * 期間は「今日〜syncDays日後」でカレンダー側を走査する。
 */
export async function deleteVanishedEvents(
  cal: calendar_v3.Calendar,
  calendarId: string,
  fetched: LabolaEvent[],
  extraKeep?: { key: string; ids: Set<string> },
) {
  const now = new Date();
  const timeMin = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + (config.syncDays + 1) * 24 * 3600 * 1000).toISOString();
  const keepLabola = new Set(fetched.map((ev) => ev.labolaId));

  const deleted: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await cal.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults: 250,
      pageToken,
    });
    for (const item of res.data.items ?? []) {
      if (!item.id) continue;
      const priv = item.extendedProperties?.private ?? {};
      let keep = false;
      if (priv[LABOLA_KEY] != null) keep = keepLabola.has(priv[LABOLA_KEY]!);
      else if (priv[CHOUSEISAN_KEY] != null) {
        const id = priv[CHOUSEISAN_KEY]!;
        keep = extraKeep?.key === CHOUSEISAN_KEY && extraKeep.ids.has(id);
      } else {
        continue; // このツールが作ったイベントではない
      }
      if (keep) continue;
      await cal.events.delete({ calendarId, eventId: item.id });
      deleted.push(`${item.summary ?? "(無題)"}`);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return deleted;
}