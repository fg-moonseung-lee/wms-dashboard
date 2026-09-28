import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { periodToRange, getWeeksInRange, weekLabel, dateToWeekStart } from '../lib/weekUtils'
import type { Period, ZoneAgg, OwnerAgg, WeekPoint } from '../lib/types'

function calcEff(std: number, act: number) {
  return act > 0 ? Math.round((std / act) * 1000) / 10 : 0
}

/** picking_zone_daily 기반 집계 훅 */
export function useZoneStats(period: Period, filters: { owner?: string; zone?: string } = {}) {
  const [zoneAggs, setZoneAggs]   = useState<ZoneAgg[]>([])
  const [ownerAggs, setOwnerAggs] = useState<OwnerAgg[]>([])
  const [weekTrend, setWeekTrend] = useState<WeekPoint[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      setError(null)

      const { start, end } = periodToRange(period)

      let q = supabase
        .from('picking_zone_daily')
        .select('work_date, owner, zone, std_time_hr, act_time_hr, pick_box, pick_amount')
        .gte('work_date', start)
        .lte('work_date', end)

      if (filters.owner) q = q.eq('owner', filters.owner)
      if (filters.zone)  q = q.eq('zone',  filters.zone)

      const { data, error: err } = await q
      if (err) { setError(err.message); setLoading(false); return }

      const rows = data ?? []

      /* ── 구역별 집계 ── */
      const zMap = new Map<string, ZoneAgg>()
      for (const r of rows) {
        const key = `${r.owner}|${r.zone}`
        const cur = zMap.get(key) ?? {
          owner: r.owner, zone: r.zone,
          std_time_hr: 0, act_time_hr: 0, pick_box: 0, pick_amount: 0, efficiency: 0,
        }
        cur.std_time_hr += r.std_time_hr
        cur.act_time_hr += r.act_time_hr
        cur.pick_box    += r.pick_box    ?? 0
        cur.pick_amount += r.pick_amount ?? 0
        zMap.set(key, cur)
      }
      const zones = [...zMap.values()].map(z => ({ ...z, efficiency: calcEff(z.std_time_hr, z.act_time_hr) }))

      /* ── 브랜드별 집계 ── */
      const oMap = new Map<string, OwnerAgg>()
      for (const r of rows) {
        const cur = oMap.get(r.owner) ?? {
          owner: r.owner,
          std_time_hr: 0, act_time_hr: 0, pick_box: 0, pick_amount: 0, efficiency: 0,
        }
        cur.std_time_hr += r.std_time_hr
        cur.act_time_hr += r.act_time_hr
        cur.pick_box    += r.pick_box    ?? 0
        cur.pick_amount += r.pick_amount ?? 0
        oMap.set(r.owner, cur)
      }
      const owners = [...oMap.values()].map(o => ({ ...o, efficiency: calcEff(o.std_time_hr, o.act_time_hr) }))

      /* ── 주간 트렌드 (브랜드별) ── */
      const weeks = getWeeksInRange(start, end)
      const tMap = new Map<string, WeekPoint>()
      for (const r of rows) {
        const ws  = dateToWeekStart(r.work_date)
        const key = filters.owner ? ws : `${ws}|${r.owner}`
        const cur = tMap.get(key) ?? {
          weekLabel: weekLabel(ws), weekStart: ws,
          owner: filters.owner ? filters.owner : r.owner,
          std_time_hr: 0, act_time_hr: 0, pick_box: 0, pick_amount: 0, efficiency: 0,
        }
        cur.std_time_hr += r.std_time_hr
        cur.act_time_hr += r.act_time_hr
        cur.pick_box    += r.pick_box    ?? 0
        cur.pick_amount += r.pick_amount ?? 0
        tMap.set(key, cur)
      }
      // 빈 주차 0 채우기
      const trend = weeks.flatMap(ws => {
        if (filters.owner) {
          const key = ws
          return [tMap.get(key) ?? {
            weekLabel: weekLabel(ws), weekStart: ws,
            owner: filters.owner, std_time_hr: 0, act_time_hr: 0,
            pick_box: 0, pick_amount: 0, efficiency: 0,
          }]
        }
        const ownerList = [...oMap.keys()]
        return ownerList.map(o => tMap.get(`${ws}|${o}`) ?? {
          weekLabel: weekLabel(ws), weekStart: ws, owner: o,
          std_time_hr: 0, act_time_hr: 0, pick_box: 0, pick_amount: 0, efficiency: 0,
        })
      }).map(p => ({ ...p, efficiency: calcEff(p.std_time_hr, p.act_time_hr) }))

      setZoneAggs(zones)
      setOwnerAggs(owners)
      setWeekTrend(trend)
      setLoading(false)
    }

    fetch()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(period), filters.owner, filters.zone])

  return { zoneAggs, ownerAggs, weekTrend, loading, error }
}
