"""
온디맨드 생산성 집계 트리거 서버 (자동화 PC에서 로컬로 실행)

기존 08:30 Windows 작업 스케줄러(WMS_RPA_Daily)를 대체. 대시보드(Vercel)에서
날짜를 선택해 "집계 실행" 버튼을 누르면 이 로컬 서버가 요청을 받아
`scripts/wms_rpa.py --date <date> --force`를 subprocess로 실행한다.
(다운로드 → 피킹/입고 자동화 → DB 적재 → git commit+push까지 기존 파이프라인 그대로)

WMS 로그인이 Playwright로 실제 브라우저를 띄우는 방식이라 이 서버는 자동화 PC에서만
동작 가능하며, 대시보드도 그 PC에서 열었을 때만 버튼이 작동한다(localhost는 브라우저
mixed-content 정책의 예외 대상).

실행:
  python scripts/trigger_server.py          # 0.0.0.0 아님, 127.0.0.1:8787 로만 바인딩

.env 추가 항목:
  TRIGGER_ALLOWED_ORIGIN=https://<실제-vercel-도메인>   (미설정 시 로컬 개발용 origin만 허용)

Windows 로그온 시 자동 시작 등록 (관리자 권한 불필요, 1회만 실행):
  schtasks /create /sc onlogon /tn WMS_TriggerServer ^
    /tr "\"<이 프로젝트 .venv>\\Scripts\\pythonw.exe\" \"<이 프로젝트 경로>\\scripts\\trigger_server.py\"" ^
    /rl limited
"""

import json
import os
import subprocess
import sys
import threading
import uuid
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Windows 콘솔 기본 코드페이지(cp949)로 실행 시 UnicodeEncodeError 방지 (wms_rpa.py와 동일 처리)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

HISTORY_PATH = BASE_DIR / "data" / "trigger_history.json"
HISTORY_MAX_ENTRIES = 100

HOST = "127.0.0.1"
PORT = 8787

DEV_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
PROD_ORIGIN = os.getenv("TRIGGER_ALLOWED_ORIGIN", "").strip()
ALLOWED_ORIGINS = DEV_ORIGINS | ({PROD_ORIGIN} if PROD_ORIGIN else set())

app = FastAPI(title="WMS 온디맨드 집계 트리거 서버")

# ─────────────────────────────────────────────────────────────────────
# CORS + Private Network Access(PNA) 대응
# 표준 CORSMiddleware는 Access-Control-Allow-Private-Network 헤더를 지원하지
# 않음(Chrome/Edge가 public 사이트 → localhost 요청 시 별도로 확인하는 헤더).
# ─────────────────────────────────────────────────────────────────────
@app.middleware("http")
async def cors_and_pna(request: Request, call_next):
    origin = request.headers.get("origin", "")
    allowed = origin in ALLOWED_ORIGINS

    if request.method == "OPTIONS":
        headers = {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
        }
        if allowed:
            headers["Access-Control-Allow-Origin"] = origin
            headers["Access-Control-Allow-Private-Network"] = "true"
        return JSONResponse({}, headers=headers)

    response = await call_next(request)
    if allowed:
        response.headers["Access-Control-Allow-Origin"] = origin
    return response


# ─────────────────────────────────────────────────────────────────────
# job 이력 (동시 실행 방지 + 디스크 영속화로 서버 재시작 후에도 이력 유지)
# ─────────────────────────────────────────────────────────────────────
_lock = threading.Lock()
_jobs: dict[str, dict] = {}


def _job_summary(job: dict) -> dict:
    return {k: v for k, v in job.items() if k != "log"}


def _load_history() -> None:
    if not HISTORY_PATH.exists():
        return
    try:
        records = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    for rec in records:
        _jobs[rec["job_id"]] = rec


def _save_history() -> None:
    records = sorted(_jobs.values(), key=lambda j: j["started_at"], reverse=True)[:HISTORY_MAX_ENTRIES]
    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


_load_history()


def _run_job(job_id: str, date_from: str, date_to: str | None):
    cmd = [sys.executable, str(BASE_DIR / "scripts" / "wms_rpa.py"), "--date", date_from, "--force"]
    if date_to and date_to != date_from:
        cmd += ["--date-to", date_to]
    proc = subprocess.Popen(
        cmd, cwd=str(BASE_DIR),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    for line in proc.stdout:
        with _lock:
            job = _jobs.get(job_id)
            if job:
                job["log"].append(line.rstrip("\n"))
                if len(job["log"]) > 500:
                    del job["log"][0]
    proc.wait()
    with _lock:
        job = _jobs.get(job_id)
        if job:
            job["status"] = "done" if proc.returncode == 0 else "error"
            job["returncode"] = proc.returncode
            job["finished_at"] = datetime.now().isoformat()
            _save_history()


class TriggerRequest(BaseModel):
    date: str  # YYYY-MM-DD (범위의 시작)
    date_to: str | None = None  # YYYY-MM-DD (범위의 끝, 포함) — 미지정 시 date와 동일(단일일)


@app.post("/api/trigger")
def trigger(req: TriggerRequest):
    try:
        datetime.strptime(req.date, "%Y-%m-%d")
        if req.date_to:
            datetime.strptime(req.date_to, "%Y-%m-%d")
    except ValueError:
        return JSONResponse({"error": "date는 YYYY-MM-DD 형식이어야 합니다."}, status_code=400)
    if req.date_to and req.date_to < req.date:
        return JSONResponse({"error": "종료일은 시작일보다 빠를 수 없습니다."}, status_code=400)

    with _lock:
        running = next((j for j in _jobs.values() if j["status"] == "running"), None)
        if running is not None:
            return JSONResponse(
                {"error": "이미 실행 중인 집계 작업이 있습니다.", "job_id": running["job_id"]},
                status_code=409,
            )
        job_id = uuid.uuid4().hex
        _jobs[job_id] = {
            "job_id": job_id,
            "date": req.date,
            "date_to": req.date_to,
            "status": "running",
            "returncode": None,
            "started_at": datetime.now().isoformat(),
            "finished_at": None,
            "log": [],
        }
        _save_history()

    threading.Thread(target=_run_job, args=(job_id, req.date, req.date_to), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/status")
def status(job_id: str | None = None):
    with _lock:
        job = _jobs.get(job_id) if job_id else None
        if job is None:
            return JSONResponse({"error": "해당 job을 찾을 수 없습니다."}, status_code=404)
        return {
            "job_id": job["job_id"],
            "date": job["date"],
            "date_to": job.get("date_to"),
            "status": job["status"],
            "returncode": job["returncode"],
            "started_at": job["started_at"],
            "finished_at": job["finished_at"],
            "log": list(job["log"])[-500:],
        }


@app.get("/api/history")
def history(limit: int = 30):
    with _lock:
        records = sorted(_jobs.values(), key=lambda j: j["started_at"], reverse=True)[:limit]
        return [_job_summary(r) for r in records]


@app.get("/api/health")
def health():
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    print(f"온디맨드 집계 트리거 서버 시작: http://{HOST}:{PORT}")
    print(f"허용 origin: {sorted(ALLOWED_ORIGINS)}")
    if not PROD_ORIGIN:
        print("경고: TRIGGER_ALLOWED_ORIGIN이 .env에 설정되지 않음 — 배포된 대시보드에서는 CORS로 막힘.")
    uvicorn.run(app, host=HOST, port=PORT)
