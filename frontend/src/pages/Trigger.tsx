import { useEffect, useRef, useState } from 'react'

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
  const [jobStatus, setJobStatus] = useState<JobStatus>('idle')
  const [log, setLog] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)
  const logBoxRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    fetch(`${SERVER_URL}/api/health`)
      .then(r => setServerUp(r.ok))
      .catch(() => setServerUp(false))
  }, [])

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
    running: <span className="text-blue-600 font-semibold">실행 중...</span>,
    done: <span className="text-green-600 font-semibold">완료</span>,
    error: <span className="text-red-600 font-semibold">오류 발생</span>,
  }[jobStatus]

  return (
    <div className="p-5">
      <div className="max-w-[640px] mx-auto bg-white rounded-xl shadow-xl border border-gray-100 p-6">
        <h2 className="text-[15px] font-bold text-gray-800 mb-1">생산성 집계 수동 실행</h2>
        <p className="text-[12px] text-gray-400 mb-4">
          선택한 날짜의 피킹+입고 데이터를 다시 수집해 DB에 반영합니다. RPA 자동 스케줄은 꺼져
          있으므로, 명절/휴무일 등으로 자동 집계가 안 된 날짜는 여기서 수동으로 실행하세요.
        </p>

        {serverUp === false && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-700">
            로컬 트리거 서버에 연결할 수 없습니다. 이 기능은 자동화 PC에서 대시보드를 열었을 때만
            동작합니다.
          </div>
        )}

        <div className="flex items-end gap-3 mb-4">
          <div>
            <label className="text-[10px] text-gray-400 block mb-1">집계 대상 날짜</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              disabled={jobStatus === 'running'}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-letusBlue disabled:opacity-50"
            />
          </div>
          <button
            onClick={handleTrigger}
            disabled={jobStatus === 'running' || serverUp === false}
            className="bg-letusBlue hover:bg-blue-600 text-white text-xs font-semibold py-1.5 px-4 rounded-lg disabled:opacity-40 transition-colors"
          >
            집계 실행
          </button>
          {statusBadge}
        </div>

        {errorMsg && (
          <p className="text-[12px] text-red-500 mb-3">{errorMsg}</p>
        )}

        {log.length > 0 && (
          <pre
            ref={logBoxRef}
            className="bg-gray-900 text-gray-200 text-[11px] leading-relaxed rounded-lg p-3 h-[320px] overflow-y-auto whitespace-pre-wrap"
          >
            {log.join('\n')}
          </pre>
        )}
      </div>
    </div>
  )
}
