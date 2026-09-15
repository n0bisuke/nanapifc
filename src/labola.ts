// LaBOLA予約サイトのスクレイパ
// 銀座deフットサル蒲田スタジアム(shop/{shopId})の個人参加イベントを日付指定で取得する
// HTMLは機械生成で安定しているため、正規表現ベースの軽量パーサを使う

import type { EventStatus, LabolaEvent } from "./types.ts";

const BASE = "https://yoyaku.labola.jp";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) nanapifc-sync/0.1 (+https://github.com/)";

/** 日付指定のイベント一覧URLを組み立てる */
export function buildEventListUrl(shopId: string, date: string, keyword: string): string {
  const params = new URLSearchParams({
    hold_on_at: date,
    category: "",
    kind: "individual",
    accept_class: "",
    keyword,
  });
  return `${BASE}/r/shop/${shopId}/event/individual/?${params.toString()}`;
}

/** 「2026/09/18（金）13:00〜14:30」を JST で解釈し、start/end のISO文字列を返す */
export function parseDateTime(dateText: string): { start: string; end: string } | null {
  const m = dateText.match(
    /(\d{4})\/(\d{2})\/(\d{2})\s*（[^）]*）\s*(\d{1,2}):(\d{2})\s*[〜~\-–]\s*(\d{1,2}):(\d{2})/,
  );
  if (!m) return null;
  const y = m[1]!;
  const mo = m[2]!;
  const d = m[3]!;
  const sh = m[4]!;
  const sm = m[5]!;
  const eh = m[6]!;
  const em = m[7]!;
  const start = jstIso(y, mo, d, sh, sm);
  // 終了が開始より早い場合は翌日にまたがる(深夜イベント)
  const crossMidnight = Number(eh) * 60 + Number(em) <= Number(sh) * 60 + Number(sm);
  const end = crossMidnight ? shiftDay(y, mo, d, eh, em) : jstIso(y, mo, d, eh, em);
  return { start, end };
}

/** JSTの各部材からISO8601(+09:00)文字列を組み立てる */
function jstIso(y: string, mo: string, d: string, h: string, mi: string): string {
  return `${y}-${mo}-${d}T${h.padStart(2, "0")}:${mi}:00+09:00`;
}

/** 日時を1日進める(深夜イベントの終了時刻用) */
function shiftDay(y: string, mo: string, d: string, h: string, mi: string): string {
  const epoch = Date.parse(`${y}-${mo}-${d}T${h.padStart(2, "0")}:${mi}:00+09:00`);
  return epochToJstIso(epoch + 24 * 3600 * 1000);
}

/** epochミリ秒をJSTのISO8601(+09:00)文字列にする */
function epochToJstIso(epoch: number): string {
  const jst = new Date(epoch + 9 * 3600 * 1000).toISOString();
  return `${jst.slice(0, 10)}T${jst.slice(11, 16)}:00+09:00`;
}

/** h3のステータス文字を EventStatus に正規化する */
export function normalizeStatus(raw: string): EventStatus {
  if (raw.includes("満席")) return "full";
  if (raw.includes("終了") || raw.includes("締切")) return "closed";
  return "open";
}

/** 「募集数 11／15」(全角/半角スラッシュ両対応)を数値ペアにする */
export function parseCapacity(raw: string): { current: number | null; capacity: number | null } {
  const m = raw.match(/(\d+)\s*[／/]\s*(\d+)/);
  if (!m) return { current: null, capacity: null };
  return { current: Number(m[1]!), capacity: Number(m[2]!) };
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function clean(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** 一覧ページのHTMLからイベントカードをパースする */
export function parseEventList(html: string, shopId: string): LabolaEvent[] {
  const anchorRe = new RegExp(
    `<a href="/r/shop/${shopId}/event/show/(\\d+)/"`,
    "g",
  );
  const matches = [...html.matchAll(anchorRe)];
  const events: LabolaEvent[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (!m) continue;
    const labolaId = m[1];
    if (!labolaId) continue;
    const chunkStart = m.index! + m[0].length;
    const chunkEnd = i + 1 < matches.length ? matches[i + 1]!.index! : html.length;
    const chunk = html.slice(chunkStart, chunkEnd);
    const ev = parseCard(chunk, labolaId, shopId);
    if (ev) events.push(ev);
  }
  return events;
}

function firstMatch(chunk: string, re: RegExp): string {
  return clean(chunk.match(re)?.[1] ?? "");
}

function parseCard(chunk: string, labolaId: string, shopId: string): LabolaEvent | null {
  const dateText = firstMatch(chunk, /<div class="date">([\s\S]*?)<\/div>/);
  const title = clean(chunk.match(/<h2>([\s\S]*?)<\/h2>/)?.[1] ?? "");
  const dt = dateText ? parseDateTime(dateText) : null;
  if (!dt) return null;
  const level = firstMatch(chunk, /<div class="level">([\s\S]*?)<\/div>/);
  const price = firstMatch(chunk, /<div class="price">([\s\S]*?)<\/div>/);
  const statusRaw = clean(chunk.match(/<h3 class="[^"]*">([\s\S]*?)<\/h3>/)?.[1] ?? "");
  const capacityRaw = firstMatch(chunk, /<div class="capacity">([\s\S]*?)<\/div>/);
  const deadlineNote = firstMatch(chunk, /<div class="sub">([\s\S]*?)<\/div>/);
  const { current, capacity } = parseCapacity(capacityRaw);
  return {
    labolaId,
    title,
    start: dt.start,
    end: dt.end,
    level,
    price,
    status: normalizeStatus(statusRaw),
    current,
    capacity,
    deadlineNote,
    url: `${BASE}/r/shop/${shopId}/event/show/${labolaId}/`,
  };
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ja" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

/** 指定日(単日)のイベントを取得する */
export async function fetchEventsForDate(
  shopId: string,
  date: string,
  keyword: string,
): Promise<LabolaEvent[]> {
  const url = buildEventListUrl(shopId, date, keyword);
  const html = await fetchPage(url);
  return parseEventList(html, shopId);
}

/**
 * 今日から syncDays 日分のイベントを取得する(日付指定URLで1日ずつ巡回)。
 * 同一イベントが複数日に現れない前提だが、念のため labolaId で重複排除する。
 */
export async function fetchUpcomingEvents(options: {
  shopId: string;
  syncDays: number;
  keyword: string;
  requestIntervalMs: number;
  now?: Date;
}): Promise<LabolaEvent[]> {
  const now = options.now ?? new Date();
  const byId = new Map<string, LabolaEvent>();
  for (let i = 0; i < options.syncDays; i++) {
    const date = toDateStr(now, i);
    const events = await fetchEventsForDate(options.shopId, date, options.keyword);
    for (const ev of events) {
      if (!byId.has(ev.labolaId)) byId.set(ev.labolaId, ev);
    }
    if (i < options.syncDays - 1) {
      await sleep(options.requestIntervalMs);
    }
  }
  const nowIso = jstNowIso(now);
  return [...byId.values()]
    .filter((ev) => ev.end >= nowIso)
    .sort((a, b) => a.start.localeCompare(b.start));
}

function toDateStr(now: Date, offsetDays: number): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000 + offsetDays * 24 * 3600 * 1000);
  return jst.toISOString().slice(0, 10);
}

function jstNowIso(now: Date): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().replace("Z", "+09:00");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}