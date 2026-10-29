export type EventStatus = "open" | "full" | "closed";

/** 同期対象のLaBOLA店舗情報 */
export interface ShopConfig {
  /** LaBOLAの店舗ID(例: 1047=蒲田スタジアム, 3007=Calcio) */
  id: string;
  /** カレンダータイトルに使う表示名(例: 「蒲田個サル」「カルチョ」) */
  name: string;
  /** 一覧ページの検索キーワード(空文字なら絞り込みなし) */
  keyword: string;
  /** イベントタイトルで会場を限定する場合の部分一致リスト(空なら全会場) */
  venues: string[];
}

/** LaBOLAの個人参加イベント(正規化済み) */
export interface LabolaEvent {
  /** LaBOLAのイベントID(カレンダー上の冪等キー。全店舗でユニークな連番) */
  labolaId: string;
  /** 元のイベント名(h2) */
  title: string;
  /** 開始日時(JST, ISO文字列) */
  start: string;
  /** 終了日時(JST, ISO文字列) */
  end: string;
  /** レベル/クラス(例: 「エンジョイ（エンジョイスタンダード）」) */
  level: string;
  /** 料金表示(例: 「メンバー 1,800円、ビジター 2,200円」) */
  price: string;
  /** 募集状況 */
  status: EventStatus;
  /** 現在の参加数(取得できない場合 null) */
  current: number | null;
  /** 定員 */
  capacity: number | null;
  /** 受付期限の補足(例: 「受付け終了まで4日」) */
  deadlineNote: string;
  /** 詳細ページURL */
  url: string;
  /** 取得元店舗ID */
  shopId: string;
  /** 取得元店舗の表示名(タイトル用) */
  shopName: string;
}