import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const SERVER_URL = 'http://localhost:8787'

type JobStatus = 'idle' | 'running' | 'done' | 'error'

interface StatusResponse {
  job_id: string
  date: string
  status: 'running' | 'done' | 'error'
  returncode: number | null
  started_at: string
  finished_at: string | null
  log: string[]
}

function todayStr(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export default function Trigger() {
  const [date, setDate] = useState(todayStr())
  const [serverUp, setServerUp] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [jobStatus, setJobStatus] = useState<JobStatus>('idle')
  const [log, setLog] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)
  const logBoxRef = useRef<HTMLPreElement | null>(null)

  function checkServer() {
    setChecking(true)
    fetch(`${SERVER_URL}/api/health`)
      .then(r => setServerUp(r.ok))
      .catch(() => setServerUp(false))
      .finally(() => setChecking(false))
  }

  useEffect(() => { checkServer() }, [])

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [log])

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  function pollStatus(jobId: string) {
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/status?job_id=${jobId}`)
        if (!res.ok) return
        const data: StatusResponse = await res.json()
        setLog(data.log)
        if (data.status !== 'running') {
          setJobStatus(data.status)
          if (pollRef.current) window.clearInterval(pollRef.current)
        }
      } catch {
        /* 일시적 네트워크 오류는 다음 폴링에서 재시도 */
      }
    }, 2000)
  }

  async function handleTrigger() {
    setErrorMsg(null)
    setLog([])
    try {
      const res = await fetch(`${SERVER_URL}/api/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const data = await res.json()
      if (res.status === 409) {
        setErrorMsg('이미 실행 중인 집계 작업이 있습니다. 잠시 후 다시 시도해주세요.')
        return
      }
      if (!res.ok) {
        setErrorMsg(data.error ?? '집계 요청에 실패했습니다.')
        return
      }
      setJobStatus('running')
      pollStatus(data.job_id)
    } catch {
      setServerUp(false)
      setErrorMsg('로컬 서버에 연결할 수 없습니다. 자동화 PC에서 대시보드를 열었는지 확인해주세요.')
    }
  }

  const statusBadge = {
    idle: null,
    running: <span className="text-[12px] font-semibold text-blue-600">실행 중...</span>,
    done: <span className="text-[12px] font-semibold text-green-600">완료</span>,
    error: <span className="text-[12px] font-semibold text-red-600">오류 발생</span>,
  }[jobStatus]

  return (
    <div className="p-5 space-y-5 animate-fade-in">

      {/* 필터 바 */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-[10px] text-gray-400 block mb-1">집계 대상 날짜</label>
              <input
                type="date" value={date} onChange={e => setDate(e.target.value)}
                disabled={jobStatus === 'running'}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue disabled:opacity-50"
              />
            </div>
            <button
              onClick={handleTrigger}
              disabled={jobStatus === 'running' || serverUp === false}
              className="bg-letusBlue hover:bg-blue-600 text-white text-xs font-semibold py-1.5 px-4 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              집계 실행
            </button>
            {statusBadge}
            <p className="text-[11px] text-gray-400 leading-relaxed ml-2 max-w-[480px]">
              선택한 날짜의 피킹+입고 데이터를 다시 수집해 DB에 반영합니다. RPA 자동 스케줄은 꺼져
              있으므로, 명절/휴무일 등으로 자동 집계가 안 된 날짜는 여기서 수동으로 실행하세요.
            </p>
          </div>

          {serverUp === false && (
            <div className="mt-4 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-[12px] text-amber-700">
                로컬 트리거 서버에 연결할 수 없습니다. 이 기능은 자동화 PC에서 대시보드를 열었을 때만 동작합니다.
              </p>
              <button
                onClick={checkServer}
                disabled={checking}
                className="shrink-0 text-[11px] font-semibold text-amber-700 border border-amber-300 rounded-lg px-2.5 py-1 hover:bg-amber-100 disabled:opacity-50 transition-colors"
              >
                {checking ? '확인 중...' : '다시 확인'}
              </button>
            </div>
          )}

          {errorMsg && (
            <p className="text-[12px] text-red-500 mt-3">{errorMsg}</p>
          )}
        </CardContent>
      </Card>

      {/* 실행 로그 */}
      {log.length > 0 && (
        <Card>
          <CardHeader className="px-5 py-3.5 border-b border-border">
            <CardTitle className="text-sm font-semibold">실행 로그</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <pre
              ref={logBoxRef}
              className="bg-gray-900 text-gray-200 text-[11px] leading-relaxed rounded-lg p-3 h-[420px] overflow-y-auto whitespace-pre-wrap"
            >
              {log.join('\n')}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
