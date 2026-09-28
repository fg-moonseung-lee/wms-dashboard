/* ── 기간 타입 ───────────────────────────────────── */
export type Period =
  | { type: 'weekly';  weekStart: string }          // 'YYYY-MM-DD' (금요일)
  | { type: 'monthly'; year: number; month: number }
  | { type: 'yearly';  year: number }               // 연간
  | { type: 'custom';  start: string; end: string }
  | { type: 'all' }                                 // 전체기간

/* ── 계층 필터 ───────────────────────────────────── */
export interface HierarchyFilter {
  center?: string   // '양지1센터' 등 (현재 단일센터라 거의 미사용)
  owner?:  string   // '퍼시스' | '일룸' | '데스커' | '3PL'
  zone?:   string   // 'H-I' | 'DPS' 등
  worker?: string   // 작업자명
}

/* ── 집계 결과 ───────────────────────────────────── */
// 2026-09-28: 가동률(표준/실적시간 비율) 개념 제거 — wave_time_hr(작업시간)/
// wms_time_hr(전체 로그인시간) 두 기준의 시간당 생산성으로 대체.
export interface ZoneAgg {
  owner:        string
  zone:         string
  wave_time_hr: number
  wms_time_hr:  number
  pick_box:     number
  pick_amount:  number
}

export interface OwnerAgg {
  owner:        string
  wave_time_hr: number
  wms_time_hr:  number
  pick_box:     number
  pick_amount:  number
}

export interface WorkerAgg {
  owner:        string
  zone:         string
  worker_name:  string
  shift:        string | null
  wave_time_hr: number
  wms_time_hr:  number
  pick_box:     number
  pick_amount:  number
}

/* 날짜별 트렌드용 */
export interface DailyPoint {
  work_date:    string
  owner?:       string
  zone?:        string
  wave_time_hr: number
  wms_time_hr:  number
  pick_box:     number
  pick_amount:  number
}
