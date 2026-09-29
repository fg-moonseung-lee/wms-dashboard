"""
WMS 데이터 수집 RPA (피킹 + 입고/이동)
매일 08:30 자동 실행 (Windows 작업 스케줄러)

흐름:
1. WMS 로그인 (Playwright → 쿠키 추출)
2. 작업자 목록 API → workers 테이블 업데이트
3. 브랜드별 PALLET HISTORY 다운로드 → data/raw/YYYY/MM/ 저장 (피킹)
4. 브랜드별 ITEM HISTORY(적치+이동) 다운로드 → data/raw/2026_입고/MM/ 저장 (입고)

브랜드별 owner 필터 (2026-07-07 확정, warehouseId와 함께 적용):
  - 일룸  (YA): owner=[T60I01,T60I03] 일룸+슬로우베드   ※ YA엔 퍼시스도 있어 owner로 갈라야 함
  - 퍼시스(YA): owner=[T60F01,T60P01,T60P02] 퍼시스+시디즈+알로소
  - 데스커(Y2): owner 필터 없음(전체) ※ Y2는 데스커 전용 창고라 필터 불필요
  - 3PL  (Y3): owner 필터 없음(전체) ※ Y3는 3PL 전용 창고라 필터 불필요
    (3PL 원본에 그룹사 물량이 섞여 나올 수 있음 — 이후 자동화 단계의 exclude_owners/_3PL_EXCL이 제거)

파일명/날짜 범위 (피킹, PALLET HISTORY):
  - 일룸/데스커(야간 있음): {브랜드}_{MMDD}_{END}.xlsx   date_from=target, date_to=target+1일
  - 퍼시스/3PL (주간 전용): {브랜드}_{MMDD}.xlsx          date_from=date_to=target

365일 운영 체제로 전환(2026-09-28)하면서 토/일/공휴일도 각자 독립된 근무일로 처리 —
과거엔 주말을 건너뛰어 "토요일 실적에 일요일 야간(월요일 준비)까지 얹는" 방식이었으나,
주말도 자체 실적이 있는 지금은 그 방식이 인접 날짜 간 야간 실적 이중집계를 유발한다
(예: 토요일 파일과 일요일 파일이 둘 다 일요일 밤~월요일 새벽 구간을 포함해 같은 사람의
같은 픽이 토요일·일요일 양쪽에 집계됨). 그래서 야간 브랜드도 항상 target+1일까지만
받는다 — 야간이 있으면 그 구간에서 주간+야간(+석간)이 다 잡히고, 야간이 없으면
자연히 주간만 남는다.

파일명 (입고/이동, ITEM HISTORY — 브랜드 무관 항상 단일일 target 기준):
  - 입고_{브랜드}_{MMDD}.xlsx  (WMS "실적관리 > ITEM HISTORY > 입하/적치실적" 탭과 동일 데이터)
  - 이동_{브랜드}_{MMDD}.xlsx  (같은 화면 "이동" 탭과 동일 데이터)

다음 단계 (수동 또는 별도 트리거):
  python scripts/batch_run.py --dates YYYY-MM-DD           (피킹)
  python scripts/inbound_batch_run.py --dates YYYY-MM-DD   (입고)

실행:
  python scripts/wms_rpa.py                     # 기본: 어제 날짜
  python scripts/wms_rpa.py --date 2026-07-04   # 특정 날짜
  python scripts/wms_rpa.py --date 2026-07-01 --date-to 2026-07-04   # 날짜 범위(순차 처리)
  python scripts/wms_rpa.py --force             # 중복 실행 무시
  python scripts/wms_rpa.py --skip-inbound      # 입고/이동 다운로드 생략(피킹만)

.env 필수:
  WMS_ID=아이디
  WMS_PW=비밀번호
  SUPABASE_POOLER_URL=postgresql://... (또는 SUPABASE_DB_URL)
"""

import argparse
import asyncio
import os
import re
import subprocess
import sys
import time
from datetime import date, datetime, time as dtime, timedelta
from pathlib import Path

# Windows 콘솔 기본 코드페이지(cp949)로 이모지/일부 문자 출력 시 죽는 문제 방지
# (VS Code 터미널 등에서 -X utf8 없이 그냥 실행해도 안전하도록, 2026-07-10)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import requests
import psycopg2
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# ── 경로/설정 ───────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
load_dotenv(BASE_DIR / ".env")

DATA_DIR       = BASE_DIR / "data" / "raw"
INBOUND_RAW_DIR = BASE_DIR / "data" / "raw" / "2026_입고"   # inbound_automation.py의 raw_dir()과 동일 경로
WMS_URL      = "https://wms.letus4u.com"
WMS_ID       = os.getenv("WMS_ID", "")
WMS_PW       = os.getenv("WMS_PW", "")
# SUPABASE_URL은 REST API 주소(https://xxx.supabase.co)라 psycopg2 DSN으로 못 씀 — DB 직결 URL 사용
SUPABASE_DB_URL = os.getenv("SUPABASE_POOLER_URL") or os.getenv("SUPABASE_DB_URL", "")

# ── Owner ID (WMS /v1/master/owner/list 기준) ───────────────────────────
# 사용자 확정(2026-07-07): 창고가 브랜드 전용이면 owner 필터 없이 "전체" 조회
# (데스커=Y2, 3PL=Y3는 그 창고에 다른 그룹사가 안 들어오므로 필터 불필요.
#  반대로 YA(양지1)는 일룸/퍼시스가 같이 있어 owner로 반드시 갈라야 함)
#
# 야간 있음 → 2일치(평일) / 3일치(토) 다운로드
NIGHT_BRANDS = {
    "일룸":   ["T60I01", "T60I03"],  # 일룸 + 슬로우베드 (YA, 필터 필요)
    "데스커": [],                     # Y2 전체 (필터 불필요)
}
# 주간 전용 → 단일 날짜 다운로드
DAY_BRANDS = {
    "퍼시스": ["T60F01", "T60P01", "T60P02"],  # 퍼시스 + 시디즈 + 알로소 (YA, 필터 필요)
    "3PL":    [],                               # Y3 전체 (필터 불필요)
}

# 브랜드별 물리 창고 (WMS 로그인 화면 창고선택 드롭다운 기준)
#   YA=양지1물류센터, Y2=양지2물류센터, Y3=양지3물류센터
# 기존 코드가 전부 "YA"로 하드코딩돼 있어 데스커/3PL 데이터가 0건으로 나오던 버그 수정 (2026-07-07)
BRAND_WAREHOUSE = {
    "일룸":   "YA",
    "퍼시스": "YA",
    "데스커": "Y2",
    "3PL":    "Y3",
}


# ── 날짜 헬퍼 ──────────────────────────────────────────────────────────
def get_file_spec(brand: str, target: date):
    """(date_from, date_to, filename) 반환

    야간 브랜드(일룸/데스커)는 항상 target+1일까지 받는다(365일 운영 체제,
    2026-09-28) — 토/일/공휴일도 각자 독립된 근무일이라 요일 구분 없이 동일 규칙.
    파일명 끝 날짜가 야간 윈도우를 결정하므로(_i1_d1_window) 이 날짜가 어긋나면
    야간 실적이 통째로 누락되거나(2026-07-11 규명), 인접 날짜와 이중집계된다
    (2026-09-28 규명 — 과거 주말-스킵 방식의 부작용).
    """
    ymd = target.strftime("%m%d")

    if brand in NIGHT_BRANDS:
        end = target + timedelta(days=1)
        emd = end.strftime("%m%d")
        return target, end, f"{brand}_{ymd}_{emd}.xlsx"
    else:
        return target, target, f"{brand}_{ymd}.xlsx"


# ── 중복 실행 방지 ─────────────────────────────────────────────────────
def already_ran(target_str: str) -> bool:
    flag = BASE_DIR / "data" / ".last_run"
    return flag.exists() and flag.read_text().strip() == target_str

def read_last_run():
    """`.last_run`의 날짜 반환 (없거나 파싱 실패 시 None)."""
    flag = BASE_DIR / "data" / ".last_run"
    if not flag.exists():
        return None
    try:
        return datetime.strptime(flag.read_text().strip(), "%Y-%m-%d").date()
    except ValueError:
        return None

def mark_ran(target_str: str):
    flag = BASE_DIR / "data" / ".last_run"
    flag.parent.mkdir(exist_ok=True)
    flag.write_text(target_str)


# 야간 데이터 수집 가능 시각: 야간조 정규 마감은 08:00이지만 2센터(데스커)가
# 캐파 부족으로 08시를 넘겨 작업하는 날이 있고, [야간] 태그 귀속 컷오프가
# 09:00이므로 (필터 _filter_d1 참조) 09:05부터 수집해야 꼬리가 안 잘림.
# (2026-07-15 확정 — 08:30 스케줄로 뜬 스크립트는 09:05까지 대기 후 수집)
READY_TIME   = dtime(9, 5)
WAIT_MAX_MIN = 90   # 이 시간 내로 준비되는 날짜는 보류 대신 대기 후 진행


def pending_targets(today: date):
    """`.last_run` 다음 날부터 어제까지 처리할 날짜 목록과 대기 시각 반환.

    반환: (targets: list[date], wait_until: datetime | None)
    wait_until이 지정되면 호출측(main)이 그 시각까지 대기 후 수집을 시작한다
    (08:30 스케줄 실행 → 09:05 야간 마감까지 대기하는 케이스).

    월요일 캐치업: 주말에 RPA가 안 돌았어도 월요일 실행 한 번으로
    금요일분(놓쳤을 경우)+토요일분을 순서대로 자동 처리한다.
    - 일요일은 실적일이 아니므로 제외 (일 21시~월 08시 야간은 토요일 파일에 귀속)
    - 토요일 특근분은 파일 범위가 토→월이라 월요일 아침 이후에만 처리 가능
      (일요일 야간이 끝나야 데이터가 완성됨) — 그 전 실행에서는 보류
    - 과도한 백필 방지: 최대 어제로부터 7일 전까지만
    """
    yesterday = today - timedelta(days=1)
    last = read_last_run()
    start = (last + timedelta(days=1)) if last else yesterday
    if start < yesterday - timedelta(days=6):
        start = yesterday - timedelta(days=6)

    out = []
    wait_until = None
    d = start
    while d <= yesterday:
        if d.weekday() == 6:  # 일요일
            d += timedelta(days=1)
            continue
        _, end, _ = get_file_spec("일룸", d)  # 야간 브랜드 기준 파일 종료일
        ready_at = datetime.combine(end, READY_TIME)
        now = datetime.now()
        if now < ready_at:
            if (ready_at - now).total_seconds() <= WAIT_MAX_MIN * 60:
                print(f"  [대기 예약] {d} 실적은 {end} {READY_TIME.strftime('%H:%M')}부터 수집 가능 — 대기 후 진행")
                out.append(d)
                wait_until = ready_at if wait_until is None else max(wait_until, ready_at)
            else:
                print(f"  [보류] {d} 실적은 {end} {READY_TIME.strftime('%H:%M')} 이후 처리 가능 (야간 작업 진행중/미완) — 다음 실행으로 미룸")
            d += timedelta(days=1)
            continue
        out.append(d)
        d += timedelta(days=1)
    return out, wait_until


# ─────────────────────────────────────────────────────────────────────
# Step 1: WMS 로그인 → 쿠키 추출
# ─────────────────────────────────────────────────────────────────────
async def _try_login(page) -> dict:
    """로그인 1회 시도 → 대시보드 진입 확인 후 쿠키 반환. 실패 시 빈 dict."""
    await page.goto(WMS_URL, wait_until="networkidle")
    await page.wait_for_timeout(1000)
    await page.locator("input[name='loginId']").fill(WMS_ID)
    await page.locator("input[name='password']").first.fill(WMS_PW)
    await page.locator("button:has-text('인증 번호 발송')").click()
    try:
        # 고정 대기 대신 대시보드 진입을 실제로 기다림 (레이스 컨디션 방지)
        await page.wait_for_url("**/v1/dashboard**", timeout=15000)
    except Exception:
        return {}
    await page.wait_for_load_state("networkidle")
    await page.wait_for_timeout(500)
    cookies = await page.context.cookies()
    cdict = {c["name"]: c["value"] for c in cookies}
    return cdict if "SESSION" in cdict else {}


async def wms_login(max_retries: int = 3) -> dict:
    print("WMS 로그인 중...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        for attempt in range(1, max_retries + 1):
            ctx  = await browser.new_context()
            page = await ctx.new_page()
            cdict = await _try_login(page)
            await ctx.close()

            if cdict:
                await browser.close()
                print(f"  로그인 완료 (쿠키 {len(cdict)}개, 시도 {attempt}/{max_retries})")
                return cdict

            print(f"  [재시도 {attempt}/{max_retries}] 로그인 미완료 — 재시도")

        await browser.close()

    raise RuntimeError("WMS 로그인 실패 (재시도 초과) — 계정/네트워크 상태 확인 필요")


# ─────────────────────────────────────────────────────────────────────
# Step 2: 작업자 목록 → workers 테이블 업데이트
# ─────────────────────────────────────────────────────────────────────
def update_workers(session: requests.Session, conn, today_str: str):
    print("\n작업자 목록 수집 중...")

    resp = session.get(
        f"{WMS_URL}/v1/system/user/search",
        params={"warehouseOperatorCd": "LETUS", "mainWarehouseId": "", "searchText": ""},
    )
    resp.raise_for_status()
    users = resp.json()

    WORKER_RE = re.compile(r'^(IPC|BS|FS)-?\d+$', re.IGNORECASE)
    workers = []

    for u in users:
        user_id   = str(u.get("userId",       "")).strip()
        user_nm   = str(u.get("userNm",        "")).strip()
        phone     = str(u.get("userHp",        "")).strip()
        warehouse = str(u.get("mainWarehouseId","")).strip()

        if warehouse != "YA":         continue
        if not WORKER_RE.match(user_id): continue

        pid = user_id.upper()
        if   pid.startswith("IPC"): owner = "일룸"
        elif pid.startswith("BS"):  owner = "퍼시스"
        elif pid.startswith("FS"):  owner = "DPC"
        else: continue

        shift_m = re.match(r"^\[([^\]]+)\]", user_nm)
        shift   = shift_m.group(1) if shift_m else ""
        display = re.sub(r'^\[[^\]]+\]', '', user_nm).strip()
        workers.append({
            "worker_id": user_id, "worker_name": user_nm,
            "display_name": display, "owner": owner,
            "shift": shift, "phone": phone,
        })

    print(f"  {len(workers)}명 수집 (양지1센터 YA)")

    cur = conn.cursor()
    for w in workers:
        cur.execute("""
            INSERT INTO workers
                (worker_id, worker_name, display_name, owner, shift,
                 group_name, phone, is_active, first_seen, last_seen)
            VALUES (%s,%s,%s,%s,%s,%s,%s,TRUE,%s,%s)
            ON CONFLICT (worker_id) DO UPDATE SET
                worker_name  = EXCLUDED.worker_name,
                display_name = EXCLUDED.display_name,
                shift        = EXCLUDED.shift,
                phone        = EXCLUDED.phone,
                is_active    = TRUE,
                last_seen    = %s,
                updated_at   = NOW()
        """, (w["worker_id"], w["worker_name"], w["display_name"],
              w["owner"], w["shift"], "", w["phone"],
              today_str, today_str, today_str))

    cur.execute("""
        UPDATE workers SET is_active = FALSE, updated_at = NOW()
        WHERE last_seen < %s AND is_active = TRUE
    """, (today_str,))

    conn.commit()
    cur.close()
    print(f"  workers 업데이트 완료 ({len(workers)}명)")


# ─────────────────────────────────────────────────────────────────────
# Step 3: PALLET HISTORY 다운로드 (피킹)
# ─────────────────────────────────────────────────────────────────────
def fetch_owner_list(session: requests.Session) -> list:
    """WMS 전체 owner 목록 조회 (ownerId, ownerNm, isUse 포함)"""
    resp = session.get(
        f"{WMS_URL}/v1/master/owner/list",
        params={"warehouseId": "YA"},
    )
    resp.raise_for_status()
    return resp.json()


def build_owner_name_map(owners: list) -> dict:
    """{ownerId: ownerNm} 매핑 — 입고/이동 raw의 OWNER 컬럼(한글명) 복원용"""
    return {o["ownerId"]: o["ownerNm"] for o in owners}


_PALLET_COLS = ["작업자", "WAVE명", "WAVE번호", "PLT ID", "오더번호", "ITEM ID",
                "피킹수량", "LOCATION", "작업일시", "OWNER"]


def _build_pallet_df(rows: list, owner_map: dict):
    """palletHistory API 원본 필드 → picking_automation_v2.py가 기대하는 raw 컬럼명으로 매핑
    (2026-07-07: 매핑 없이 raw JSON 그대로 저장하던 버그 수정 — KeyError: '작업일시' 원인)
    """
    import pandas as pd
    recs = [{
        "작업자": r.get("fstUsrNm"),
        "WAVE명": r.get("waveNm"),
        "WAVE번호": r.get("waveNo"),
        "PLT ID": r.get("unitLoadId"),
        "오더번호": r.get("orderNo"),
        "ITEM ID": r.get("itemId"),
        "피킹수량": r.get("confirmQty"),
        "LOCATION": r.get("toLocation"),
        "작업일시": r.get("fstSysDt"),
        "OWNER": owner_map.get(r.get("ownerId"), r.get("ownerId")),
    } for r in rows]
    df = pd.DataFrame(recs, columns=_PALLET_COLS)
    # 작업일시 오름차순 정렬 — KGA 변환수식의 기준일(P1)이 "파일 첫 행의 날짜"로 잡히므로
    # 첫 행이 반드시 대상일이 되도록 보장 (행 순서가 뒤섞이면 ㈜ 부여·야식차감이 통째로 틀어짐, 2026-07-08 규명)
    if len(df):
        df = df.sort_values("작업일시", kind="stable").reset_index(drop=True)
    return df


def fetch_pallet_history(session: requests.Session, owner_ids: list,
                         date_from: date, date_to: date, owner_map: dict,
                         warehouse_id: str = "YA"):
    resp = session.get(
        f"{WMS_URL}/v1/performance/palletHistory/getPerformancePalletHistoryList",
        params=[
            ("warehouseId", warehouse_id), ("itemId", ""),
            ("fromDt", date_from.strftime("%Y%m%d")),
            ("toDt",   date_to.strftime("%Y%m%d")),
            ("historyYn", "N"),
        ] + [("ownerIdArr", oid) for oid in owner_ids],
    )
    resp.raise_for_status()
    return _build_pallet_df(resp.json(), owner_map)


def download_all(session: requests.Session, target: date, owner_map: dict) -> dict:
    """전체 브랜드 PALLET HISTORY 다운로드. 반환: {brand: Path}"""
    save_dir = DATA_DIR / target.strftime("%Y/%m")
    save_dir.mkdir(parents=True, exist_ok=True)

    all_brands = {**NIGHT_BRANDS, **DAY_BRANDS}
    downloaded = {}

    print(f"\n피킹 데이터 다운로드 (target={target}) ...")

    for brand, owner_ids in all_brands.items():
        d_from, d_to, fname = get_file_spec(brand, target)
        day_label = f"{d_from.strftime('%m/%d')}~{d_to.strftime('%m/%d')}" \
                    if d_from != d_to else d_from.strftime('%m/%d')

        print(f"  [{brand}] {day_label} 수집 중...")
        try:
            df = fetch_pallet_history(session, owner_ids, d_from, d_to, owner_map, BRAND_WAREHOUSE[brand])
            if len(df) == 0:
                print(f"    0건 — 파일 미저장")
                continue

            path = save_dir / fname
            df.to_excel(str(path), index=False)
            downloaded[brand] = path
            print(f"    {len(df)}건 → {path.name}")

        except Exception as e:
            print(f"    오류: {e}")

    return downloaded


# ─────────────────────────────────────────────────────────────────────
# Step 4: ITEM HISTORY 다운로드 (입고/이동) — 항상 단일일(target)
# ─────────────────────────────────────────────────────────────────────
_INBOUND_COLS = ["OWNER", "ITEM ID", "구분", "수량", "LOCATION", "LOT 번호",
                 "입고일자", "작업자계정", "작업자", "입고 차수", "입하번호",
                 "입고 유형", "작업일시"]
_MOVE_COLS    = ["OWNER", "ITEM ID", "이동수량", "From Location", "To Location",
                 "작업일시", "작업자", "사용 시스템", "조정 사유", "상세 설명"]


def fetch_item_history(session: requests.Session, owner_ids: list, target: date,
                       warehouse_id: str = "YA") -> dict:
    """실적관리 > ITEM HISTORY 화면과 동일한 API.
    한 번의 호출로 입하/입고실적, 입하/적치실적, 피킹실적, 이동, 재고조정을 모두 반환.
    우리가 쓰는 건 inboundHistoryList2(적치실적=입고) / moveHistoryList(이동) 뿐.
    """
    ymd = target.strftime("%Y%m%d")
    resp = session.get(
        f"{WMS_URL}/v1/performance/itemHistory/getPerformanceItemHistoryList",
        params=[
            ("warehouseId", warehouse_id), ("fromDt", ymd), ("toDt", ymd), ("historyYn", "N"),
        ] + [("ownerIdArr", oid) for oid in owner_ids],
    )
    resp.raise_for_status()
    return resp.json()


def _build_inbound_df(rows: list, owner_map: dict):
    import pandas as pd
    recs = [{
        "OWNER": owner_map.get(r["ownerId"], r["ownerId"]),
        "ITEM ID": r["itemId"],
        "구분": r["gubun"],
        "수량": r["confirmQty"],
        "LOCATION": r["toLocation"],
        "LOT 번호": r["lotNo"],
        "입고일자": r["ipgoDate"],
        "작업자계정": r["fstUsrCd"],
        "작업자": r["userNm"],
        "입고 차수": r["wpnSeq"],
        "입하번호": r["inboundNo"],
        "입고 유형": r["receiptTypeNm"],
        "작업일시": r["historyDt"],
    } for r in rows]
    return pd.DataFrame(recs, columns=_INBOUND_COLS)


def _build_move_df(rows: list, owner_map: dict):
    import pandas as pd
    recs = [{
        "OWNER": owner_map.get(r["ownerId"], r["ownerId"]),
        "ITEM ID": r["itemId"],
        "이동수량": r["currentStockQty"],
        "From Location": r["locationId"],
        "To Location": r["toLocationId"],
        "작업일시": r["moveDt"],
        "작업자": r["userNm"],
        "사용 시스템": r["moveSystem"],
        "조정 사유": r["adjustReason"],
        "상세 설명": r["adjustRemark"],
    } for r in rows]
    return pd.DataFrame(recs, columns=_MOVE_COLS)


def download_inbound_move(session: requests.Session, target: date, owner_map: dict) -> dict:
    """브랜드별 입고_/이동_ raw 다운로드. 반환: {"입고_<brand>"|"이동_<brand>": Path}"""
    save_dir = INBOUND_RAW_DIR / target.strftime("%m")
    save_dir.mkdir(parents=True, exist_ok=True)

    all_brands = {**NIGHT_BRANDS, **DAY_BRANDS}   # 브랜드 그룹은 피킹과 동일 (야간 구분 없음, 항상 단일일)
    mmdd = target.strftime("%m%d")
    downloaded = {}

    print(f"\n입고/이동 데이터 다운로드 (target={target}) ...")

    for brand, owner_ids in all_brands.items():
        print(f"  [{brand}] {mmdd} 수집 중...")
        try:
            data = fetch_item_history(session, owner_ids, target, BRAND_WAREHOUSE[brand])

            inbound_df = _build_inbound_df(data.get("inboundHistoryList2", []), owner_map)
            move_df    = _build_move_df(data.get("moveHistoryList", []), owner_map)

            if len(inbound_df):
                p = save_dir / f"입고_{brand}_{mmdd}.xlsx"
                inbound_df.to_excel(str(p), index=False)
                downloaded[f"입고_{brand}"] = p
                print(f"    입고 {len(inbound_df)}건 → {p.name}")
            else:
                print(f"    입고 0건 — 파일 미저장")

            if len(move_df):
                p = save_dir / f"이동_{brand}_{mmdd}.xlsx"
                move_df.to_excel(str(p), index=False)
                downloaded[f"이동_{brand}"] = p
                print(f"    이동 {len(move_df)}건 → {p.name}")
            else:
                print(f"    이동 0건 — 파일 미저장")

        except Exception as e:
            print(f"    오류: {e}")

    return downloaded


# ─────────────────────────────────────────────────────────────────────
# Step 5: 자동화 → DB 적재 → git 커밋/push (2026-07-08)
# ─────────────────────────────────────────────────────────────────────
def _run_step(label: str, cmd: list, fatal: bool = True) -> bool:
    print(f"\n[{label}] 실행 중...")
    ret = subprocess.run(cmd, cwd=str(BASE_DIR), capture_output=True,
                         text=True, encoding="utf-8", errors="replace")
    tail = (ret.stdout or "")[-2000:]
    print(tail)
    if ret.returncode != 0:
        suffix = "파이프라인 중단, 이후 단계(DB적재/배포) 생략" if fatal else "파이프라인은 계속 진행 (보조 산출물이라 non-fatal)"
        print(f"  [실패] {label} exit={ret.returncode} — {suffix}")
        print((ret.stderr or "")[-1500:])
        return False
    return True


def _git_commit_push(target: date) -> bool:
    """해당 날짜의 아카이브 JSON만 골라 커밋 + push. 변경 없으면 조용히 스킵."""
    month_dir = f"data/daily/{target.strftime('%Y-%m')}"
    candidates = [f"{month_dir}/{p}_{target}.json" for p in ("zones", "workers", "result", "inbound")]
    existing = [f for f in candidates if (BASE_DIR / f).exists()]
    if not existing:
        print("  커밋할 아카이브 파일 없음 — 스킵")
        return True

    subprocess.run(["git", "add"] + existing, cwd=str(BASE_DIR), check=True)

    diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=str(BASE_DIR))
    if diff.returncode == 0:
        print("  변경사항 없음 — 커밋 스킵 (이미 반영됨)")
        return True

    msg = f"data: {target} 피킹+입고 일별 아카이브 (RPA 자동 파이프라인)"
    commit = subprocess.run(["git", "commit", "-m", msg], cwd=str(BASE_DIR),
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    if commit.returncode != 0:
        print("  [실패] git commit:", commit.stderr[-500:])
        return False

    push = subprocess.run(["git", "push", "origin", "main"], cwd=str(BASE_DIR),
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    if push.returncode != 0:
        print("  [실패] git push:", push.stderr[-500:])
        return False
    print("  [완료] 커밋+push 성공")
    return True


def run_pipeline(target: date) -> bool:
    """다운로드 완료 후: 피킹 자동화 → 입고 자동화 → git 배포. 각 단계 실패 시 중단."""
    target_str = str(target)
    print(f"\n{'='*55}")
    print("자동화 파이프라인 (자동화 → DB 적재 → 배포)")
    print(f"{'='*55}")

    if not _run_step("피킹 자동화+DB적재", [sys.executable, "scripts/batch_run.py",
                                        "--dates", target_str]):
        return False

    if not _run_step("입고 자동화+DB적재", [sys.executable, "scripts/inbound_batch_run.py",
                                        "--dates", target_str]):
        return False

    # 피킹↔입고 겸업 시간 안분 — 둘 다 1차 적재된 뒤에만 의미가 있는 후처리 단계.
    # 실패해도(예: 그날 raw 파일 일부 없음) 이미 적재된 값은 그대로 유효하므로
    # 배포는 계속 진행 (non-fatal, 2026-09-29).
    _run_step("피킹↔입고 시간 안분", [sys.executable, "scripts/reconcile_cross_function.py",
                                  "--date", target_str], fatal=False)

    # 리포트는 보조 산출물 — 실패해도 배포는 계속 진행 (non-fatal)
    _run_step("일일 리포트 생성", [sys.executable, "scripts/generate_daily_report.py",
                                "--date", target_str], fatal=False)

    print("\n[배포] git 커밋+push...")
    return _git_commit_push(target)


# ─────────────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────────────
async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date",  help="집계 대상 날짜 YYYY-MM-DD (기본: 어제)")
    ap.add_argument("--date-to", help="--date와 함께 사용 시 날짜 범위의 끝(포함, YYYY-MM-DD) — 여러 날짜를 순차 처리")
    ap.add_argument("--force", action="store_true", help="중복 실행 무시")
    ap.add_argument("--skip-inbound", action="store_true", help="입고/이동 다운로드 생략 (피킹만)")
    ap.add_argument("--skip-pipeline", action="store_true",
                    help="다운로드만 하고 자동화/DB적재/배포는 생략 (수동 확인용)")
    args = ap.parse_args()

    today = datetime.now().date()
    today_str = str(today)

    if args.date:
        start = datetime.strptime(args.date, "%Y-%m-%d").date()
        end = datetime.strptime(args.date_to, "%Y-%m-%d").date() if args.date_to else start
        if end < start:
            print("--date-to는 --date보다 빠를 수 없습니다.")
            return
        all_dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]
        if args.force:
            targets = all_dates
        else:
            targets = [d for d in all_dates if not already_ran(str(d))]
            skipped = [d for d in all_dates if already_ran(str(d))]
            if skipped:
                print(f"이미 실행 완료(스킵): {', '.join(str(d) for d in skipped)} (--force 로 재실행)")
            if not targets:
                print("처리할 날짜 없음 (모두 이미 실행 완료).")
                return
    else:
        targets, wait_until = pending_targets(today)
        if not targets:
            print("처리할 날짜 없음 (모두 완료 또는 보류).")
            return
        if wait_until:
            now = datetime.now()
            if now < wait_until:
                wait_s = (wait_until - now).total_seconds()
                print(f"야간 마감 대기: {wait_until.strftime('%H:%M')}까지 {int(wait_s // 60)}분 대기 후 수집 시작...")
                time.sleep(wait_s)

    print(f"\n{'='*55}")
    print(f"WMS 데이터 수집 RPA")
    print(f"  실행: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  집계 대상: {', '.join(str(t) for t in targets)}")
    print(f"{'='*55}\n")

    conn = psycopg2.connect(SUPABASE_DB_URL)
    print("DB 연결 성공")

    cookies = await wms_login()
    session = requests.Session()
    session.cookies.update(cookies)
    session.headers.update({"User-Agent": "Mozilla/5.0", "Referer": WMS_URL})

    try:
        update_workers(session, conn, today_str)
        owners    = fetch_owner_list(session)
        owner_map = build_owner_name_map(owners)
    except Exception as e:
        import traceback
        print(f"\n오류: {e}")
        traceback.print_exc()
        conn.close()
        return

    last_run = read_last_run()
    all_ok = True

    for target in targets:
        target_str = str(target)
        print(f"\n{'='*55}")
        print(f"[{target_str}] 처리 시작")
        print(f"{'='*55}")

        try:
            downloaded = download_all(session, target, owner_map)
            if not args.skip_inbound:
                downloaded.update(
                    download_inbound_move(session, target, owner_map)
                )
        except Exception as e:
            import traceback
            print(f"\n[{target_str}] 다운로드 오류: {e}")
            traceback.print_exc()
            # 실패한 날짜를 건너뛰고 mark_ran 하면 영구 누락됨 — 여기서 중단
            all_ok = False
            break

        # 과거 날짜 수동 재실행(--date)이 .last_run을 되감지 않도록 앞으로만 갱신
        if last_run is None or target > last_run:
            mark_ran(target_str)
            last_run = target

        print(f"\n[{target_str}] 수집 완료  {datetime.now().strftime('%H:%M:%S')}")
        if downloaded:
            print(f"저장 파일 ({len(downloaded)}개):")
            for key, path in downloaded.items():
                print(f"  {path.name}")
        else:
            print("저장된 파일 없음 — 파이프라인 생략")
            continue

        if args.skip_pipeline:
            print(f"--skip-pipeline 지정됨. 수동 실행:")
            print(f"  python scripts/batch_run.py --dates {target_str}")
            print(f"  python scripts/inbound_batch_run.py --dates {target_str}")
            continue

        ok = run_pipeline(target)
        all_ok = all_ok and ok
        print(f"\n[{target_str}] 파이프라인 {'완료 ✓' if ok else '중단됨 ✗ — 위 로그 확인 필요'}")

    conn.close()
    print(f"\n{'='*55}")
    print(f"전체 {'완료 ✓' if all_ok else '일부 실패 ✗ — 위 로그 확인 필요'}  {datetime.now().strftime('%H:%M:%S')}")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    asyncio.run(main())
