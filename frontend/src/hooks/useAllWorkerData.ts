import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface WorkerActivityRow {
  work_date: string
  owner: string
  zone: string
  worker_name: string
}

const PAGE = 1000

/** picking_worker_daily 전체 행(work_date/owner/zone/worker_name만) — 구역/브랜드/센터
 *  단위로 근태시간을 합산할 때 "그 범위에서 활동한 작업자 집합"을 구하는 용도. */
export function useAllWorkerData() {
  const [rows, setRows] = useState<WorkerActivityRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchAll() {
      const all: WorkerActivityRow[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('picking_worker_daily')
          .select('work_date, owner, zone, worker_name')
          .order('work_date')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        all.push(...(data as WorkerActivityRow[]))
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
