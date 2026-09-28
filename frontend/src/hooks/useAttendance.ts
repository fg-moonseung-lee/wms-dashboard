import { useCallback, useEffect, useState } from 'react'
import { supabase, stripTag, CONTRACTOR_ZONE, CONTRACTOR_OWNER, contractorFromWorkerId } from '../lib/supabase'

const SHIFT_RE = /^\[([^\]]+)\]/
function extractShift(nameRaw: string): string {
  return SHIFT_RE.exec(nameRaw)?.[1] ?? '주간'
}

export interface AttendanceRow {
  worker_name: string   // 태그 제거된 표시 이름 (근태 키)
  source:      string   // 대표 구역/브랜드 (여러 곳에 걸치면 첫 번째 것)
  contractor:  string
  shift:       string   // 주간/야간/석간 등 — 일괄입력 그룹 기준
  wms_time_hr: number    // 참고용 — 그 이름의 그날 WMS시간 합
  hours:       number | null
}

/** 특정 날짜의 근태 마감 입력 데이터 — 그날 피킹+입고로 활동한 작업자를 자동 표시하고,
 *  이미 입력된 attendance_daily 값이 있으면 프리필한다.
 *
 *  소속(도급사) 판정: 양지1센터(일룸/퍼시스/DPC) 작업자는 workers.worker_id 접두사
 *  (IPC/BS/FS)로 고정 판정 — 그날 어느 zone/브랜드에서 일했는지와 무관해서 피킹+입고
 *  겸업자도 정확한 소속 하나로 나온다. workers 테이블에 없는 데스커/3PL은 zone/brand
 *  매핑으로 폴백(그 두 센터는 어차피 단일 도급사라 문제없음). */
export function useAttendance(workDate: string) {
  const [rows, setRows] = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workDate) return
    setLoading(true)
    setError(null)

    const [pickRes, inboundRes, attRes, workersRes] = await Promise.all([
      supabase.from('picking_worker_daily')
        .select('zone, worker_name, shift, wms_time_hr')
        .eq('work_date', workDate),
      supabase.from('inbound_worker_daily')
        .select('brand, worker, worker_display, hours')
        .eq('work_date', workDate),
      supabase.from('attendance_daily')
        .select('worker_name, hours')
        .eq('work_date', workDate),
      supabase.from('workers')
        .select('worker_id, display_name'),
    ])

    const err = pickRes.error || inboundRes.error || attRes.error || workersRes.error
    if (err) { setError(err.message); setLoading(false); return }

    const idByName = new Map<string, string>()
    for (const w of workersRes.data ?? []) idByName.set(w.display_name, w.worker_id)

    const map = new Map<string, AttendanceRow>()

    for (const r of pickRes.data ?? []) {
      const name = stripTag(r.worker_name ?? '')
      if (!name) continue
      const cur = map.get(name) ?? {
        worker_name: name, source: r.zone, contractor: CONTRACTOR_ZONE[r.zone] ?? '-',
        shift: r.shift ?? extractShift(r.worker_name ?? ''), wms_time_hr: 0, hours: null,
      }
      cur.wms_time_hr += r.wms_time_hr ?? 0
      map.set(name, cur)
    }
    for (const r of inboundRes.data ?? []) {
      const name = stripTag(r.worker_display ?? '')
      if (!name) continue
      const cur = map.get(name) ?? {
        worker_name: name, source: r.brand, contractor: CONTRACTOR_OWNER[r.brand] ?? '-',
        shift: extractShift(r.worker ?? ''), wms_time_hr: 0, hours: null,
      }
      cur.wms_time_hr += r.hours ?? 0
      map.set(name, cur)
    }
    // 양지1센터 소속은 workers.worker_id 접두사로 재확정 (zone/brand 추정보다 정확)
    for (const row of map.values()) {
      const workerId = idByName.get(row.worker_name)
      if (workerId) {
        const c = contractorFromWorkerId(workerId)
        if (c) row.contractor = c
      }
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
    setRows(prev => prev.map(r => r.worker_name === worker_name ? { ...r, hours } : r))
    return true
  }, [workDate])

  /** 지정된 이름들 중 아직 hours가 비어있는 사람에게만 일괄로 값을 채운다(이미 입력된
   *  값은 덮어쓰지 않음 — 개별 수정은 그대로 유지). */
  const bulkFillEmpty = useCallback(async (names: string[], hours: number) => {
    const targets = rows.filter(r => names.includes(r.worker_name) && r.hours == null)
    if (targets.length === 0) return true
    const now = new Date().toISOString()
    const { error: err } = await supabase
      .from('attendance_daily')
      .upsert(
        targets.map(t => ({ work_date: workDate, worker_name: t.worker_name, hours, updated_at: now })),
        { onConflict: 'work_date,worker_name' },
      )
    if (err) { setError(err.message); return false }
    const targetNames = new Set(targets.map(t => t.worker_name))
    setRows(prev => prev.map(r => targetNames.has(r.worker_name) ? { ...r, hours } : r))
    return true
  }, [workDate, rows])

  return { rows, loading, error, save, bulkFillEmpty, reload: load }
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
