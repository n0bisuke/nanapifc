// 環境変数による設定の集約
// GitHub Actionsでは Secrets/変数 から、ローカルでは .dev.env から供給される

import { readFileSync, existsSync } from "node:fs";

/** ローカル開発用に .dev.env(KEY=VALUE)を環境変数に取り込む(既存の環境変数を優先) */
function loadDotEnv(path = ".dev.env"): void {
  if (process.env.CI || !existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    if (process.env[key] === undefined) process.env[key] = m[2]!.trim();
  }
}

loadDotEnv();

export interface Config {
  /** LaBOLAの店舗ID(蒲田スタジアム = 1047) */
  shopId: string;
  /** 同期する日数(今日から起算) */
  syncDays: number;
  /** 検索キーワード(デフォルトは「チーム参加OK」のイベントだけを取る) */
  fetchKeyword: string;
  /** 対象カレンダーID(フットサルのみのカレンダー) */
  calendarId: string;
  /** 調整さんの出欠人数も入れた版のカレンダーID(空なら同期しない) */
  attendanceCalendarId: string;
  /** 調整さんの出欠表URL(カンマ区切りで複数可。空なら出欠を取らない) */
  chouseisanUrls: string[];
  /** サービスアカウント秘密鍵JSON(base64または生JSON文字列) */
  saKey: string;
  /** 残り何名以下で「△(残りわずか)」にするか */
  lowSeatsThreshold: number;
  /** リクエスト間隔(ミリ秒) */
  requestIntervalMs: number;
  /** タイムゾーン(サイトはJST運用) */
  timeZone: string;
}

function readEnv(): Config {
  const syncDays = Number(process.env.SYNC_DAYS ?? "31");
  return {
    shopId: process.env.SHOP_ID ?? "1047",
    syncDays: Number.isFinite(syncDays) && syncDays > 0 ? Math.floor(syncDays) : 31,
    fetchKeyword: process.env.FETCH_KEYWORD ?? "チーム",
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "",
    attendanceCalendarId: process.env.GOOGLE_CALENDAR_ATTENDANCE_ID ?? "",
    chouseisanUrls: splitUrlList(process.env.CHOUSEISAN_URL ?? ""),
    saKey: process.env.GCP_SA_KEY ?? "",
    lowSeatsThreshold: Number(process.env.LOW_SEATS_THRESHOLD ?? "3"),
    requestIntervalMs: Number(process.env.REQUEST_INTERVAL_MS ?? "500"),
    timeZone: process.env.TIME_ZONE ?? "Asia/Tokyo",
  };
}

/** カンマ区切りのURLリストを分解する(前後の空白と空要素は除去) */
export function splitUrlList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = readEnv();