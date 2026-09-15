// 調整さん(chouseisan.com)のスクレイパ
// 出欠表ページのHTMLに埋め込まれた window.Chouseisan JSON をパースして集計する

export interface ChouseisanSlot {
  /** 日程候補の番号(1始まり) */
  num: number;
  /** 元の表示(例: 「9/26(土) 昼~夕方頃」) */
  label: string;
  /** 日付(YYYY-MM-DD, 年は現在に近い方から推定) */
  date: string;
  /** 時刻表示(例: 「19:00〜」/「昼~夕方頃」)。ない場合はnull */
  time: string | null;
  /** ○(行ける)人の名前一覧 */
  ok: string[];
  /** △(たぶん行ける)人の名前一覧 */
  maybe: string[];
  /** ×の人の名前一覧 */
  no: string[];
}

export interface ChouseisanData {
  /** 調整さんのイベントID(URLのh=...) */
  id: string;
  /** 出欠表のタイトル(例: 「nanapi 9月~10月上旬」) */
  name: string;
  /** 締切済みフラグ */
  deadlined: boolean;
  slots: ChouseisanSlot[];
}

/** HTMLから window.Chouseisan = {...} のJSON部分を取り出す */
export function extractChouseisanJson(html: string): string | null {
  const m = html.match(/window\.Chouseisan\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (!m) return null;
  // JSのオブジェクトリテラルには末尾カンマがあるので除去してJSONにする
  return m[1]!.replace(/,\s*([}\]])/g, "$1");
}

/** 「9/26(土) 昼~夕方頃」を日付と時刻に分解する(年は現在に最も近い年を推定) */
export function parseSlotLabel(label: string, now: Date): { date: string; time: string | null } | null {
  const m = label.match(/(\d{1,2})\/(\d{1,2})(?:\([^)]*\))?\s*(.*)/);
  if (!m) return null;
  const month = Number(m[1]!);
  const day = Number(m[2]!);
  const rest = m[3]!.trim();
  const timeMatch = rest.match(/(\d{1,2}):(\d{2})/);
  const time = timeMatch ? `${timeMatch[1]!.padStart(2, "0")}:${timeMatch[2]!}〜` : null;

  // 年は確定しないため、前年〜翌年の候補から「現在に最も近い」日付を選ぶ
  const thisYear = new Date(now.getTime() + 9 * 3600 * 1000).getUTCFullYear();
  let best: { epoch: number; iso: string } | null = null;
  for (const y of [thisYear - 1, thisYear, thisYear + 1]) {
    const iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const epoch = Math.abs(Date.parse(`${iso}T00:00:00+09:00`) - now.getTime());
    if (!best || epoch < best.epoch) best = { epoch, iso };
  }
  return best ? { date: best.iso, time } : null;
}

/** window.Chouseisan JSONを正規化する */
export function parseChouseisan(jsonText: string, now: Date): Omit<ChouseisanData, "id"> & { id: string } {
  const data = JSON.parse(jsonText) as {
    event: {
      id: string;
      name: string;
      choices: { num: number; choice: string }[];
      members: { name: string; kouho: number[] }[];
    };
    deadlined?: boolean;
  };
  const ev = data.event;
  const slots: ChouseisanSlot[] = [];
  for (const c of ev.choices) {
    const parsed = parseSlotLabel(c.choice, now);
    if (!parsed) continue;
    const ok: string[] = [];
    const maybe: string[] = [];
    const no: string[] = [];
    for (const member of ev.members) {
      const code = member.kouho[c.num - 1] ?? 0;
      if (code === 1) ok.push(member.name);
      else if (code === 2) maybe.push(member.name);
      else if (code === 3) no.push(member.name);
    }
    slots.push({
      num: c.num,
      label: c.choice.trim(),
      date: parsed.date,
      time: parsed.time,
      ok,
      maybe,
      no,
    });
  }
  return {
    id: ev.id,
    name: ev.name,
    deadlined: Boolean(data.deadlined),
    slots,
  };
}

/** 出欠表ページを取得して正規化する */
export async function fetchChouseisan(url: string): Promise<ChouseisanData> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) nanapifc-sync/0.1",
    },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const html = await res.text();
  const json = extractChouseisanJson(html);
  if (!json) throw new Error("調整さんのデータ(window.Chouseisan)が見つかりません");
  return parseChouseisan(json, new Date());
}

/** 1スロット分の説明行(例: 「○4/△2/×6 … のびすけ,あまの,…」) */
export function formatSlotLine(slot: ChouseisanSlot): string {
  const members = slot.ok.length > 0 ? ` … ${slot.ok.join(", ")}` : "";
  const maybe = slot.maybe.length > 0 ? ` (△: ${slot.maybe.join(", ")})` : "";
  return `${slot.label}: ○${slot.ok.length}/△${slot.maybe.length}/×${slot.no.length}${members}${maybe}`;
}

/** 特定の日付の出欠スロットを抽出する */
export function slotsForDate(slots: ChouseisanSlot[], date: string): ChouseisanSlot[] {
  return slots.filter((s) => s.date === date);
}