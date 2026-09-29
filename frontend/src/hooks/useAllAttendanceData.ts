import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface AttendanceRecord {
  work_date: string
  worker_name: string   // 태그 제거된 표시 이름
  hours: number
}

const PAGE = 1000

/** attendance_daily 전체 행 — 구역/브랜드/센터별 근태시간 합산용(sumAttendanceHours 참조). */
export function useAllAttendanceData() {
  const [rows, setRows] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchAll() {
      const all: AttendanceRecord[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('attendance_daily')
          .select('work_date, worker_name, hours')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        all.push(...(data as AttendanceRecord[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      if (!cancelled) { setRows(all); setLoading(false) }
    }

    fetchAll()
    return () => { cancelled = true }
  }, [])

  return { rows, loading }
}
