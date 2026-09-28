import { useCallback, useEffect, useState } from 'react'
import { supabase, stripTag, CONTRACTOR_ZONE, CONTRACTOR_OWNER } from '../lib/supabase'

export interface AttendanceRow {
  worker_name: string   // 태그 제거된 표시 이름 (근태 키)
  source:      string   // 대표 구역/브랜드 (여러 곳에 걸치면 첫 번째 것)
  contractor:  string
  wms_time_hr: number    // 참고용 — 그 이름의 그날 WMS시간 합
  hours:       number | null
  saved:       boolean   // 방금 저장 성공 표시 (일시적)
}

/** 특정 날짜의 근태 마감 입력 데이터 — 그날 피킹+입고로 활동한 작업자를 자동 표시하고,
 *  이미 입력된 attendance_daily 값이 있으면 프리필한다. */
export function useAttendance(workDate: string) {
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workDate) return
    setLoading(true)
    setError(null)

    const [pickRes, inboundRes, attRes] = await Promise.all([
      supabase.from('picking_worker_daily')
        .select('zone, worker_name, wms_time_hr')
        .eq('work_date', workDate),
      supabase.from('inbound_worker_daily')
        .select('brand, worker_display, hours')
        .eq('work_date', workDate),
      supabase.from('attendance_daily')
        .select('worker_name, hours')
        .eq('work_date', workDate),
    ])

    const err = pickRes.error || inboundRes.error || attRes.error
    if (err) { setError(err.message); setLoading(false); return }

    const map = new Map<string, AttendanceRow>()

    for (const r of pickRes.data ?? []) {
      const name = stripTag(r.worker_name ?? '')
      if (!name) continue
      const cur = map.get(name) ?? {
        worker_name: name, source: r.zone, contractor: CONTRACTOR_ZONE[r.zone] ?? '-',
        wms_time_hr: 0, hours: null, saved: false,
      }
      cur.wms_time_hr += r.wms_time_hr ?? 0
      map.set(name, cur)
    }
    for (const r of inboundRes.data ?? []) {
      const name = stripTag(r.worker_display ?? '')
      if (!name) continue
      const cur = map.get(name) ?? {
        worker_name: name, source: r.brand, contractor: CONTRACTOR_OWNER[r.brand] ?? '-',
        wms_time_hr: 0, hours: null, saved: false,
      }
      cur.wms_time_hr += r.hours ?? 0
      map.set(name, cur)
    }
    for (const r of attRes.data ?? []) {
      const cur = map.get(r.worker_name)
      if (cur) cur.hours = r.hours
    }

    setRows([...map.values()].sort((a, b) => a.worker_name.localeCompare(b.worker_name, 'ko')))
    setLoading(false)
  }, [workDate])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (worker_name: string, hours: number) => {
    const { error: err } = await supabase
      .from('attendance_daily')
      .upsert({ work_date: workDate, worker_name, hours, updated_at: new Date().toISOString() },
               { onConflict: 'work_date,worker_name' })
    if (err) { setError(err.message); return false }
    setRows(prev => prev.map(r => r.worker_name === worker_name ? { ...r, hours, saved: true } : r))
    return true
  }, [workDate])

  return { rows, loading, error, save, reload: load }
}

/** 특정 작업자(원본 이름, 태그 포함 가능)의 날짜별 근무시간 맵 — WorkerDetail 일별 상세용. */
export function useWorkerAttendance(workerNameRaw: string | undefined, dates: string[]) {
  const [map, setMap] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    if (!workerNameRaw || dates.length === 0) { setMap(new Map()); return }
    const name = stripTag(workerNameRaw)
    supabase
      .from('attendance_daily')
      .select('work_date, hours')
      .eq('worker_name', name)
      .in('work_date', dates)
      .then(({ data }) => {
        setMap(new Map((data ?? []).map(r => [r.work_date, r.hours as number])))
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerNameRaw, JSON.stringify(dates)])

  return map
}
