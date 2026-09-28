# -*- coding: utf-8 -*-
"""
피킹 실적 DB 적재기 (Supabase)

- --wipe : 실적 4개 테이블(picking_worker_daily, picking_zone_daily, worker_daily, zone_daily) TRUNCATE
           (workers 마스터, cbm_master 는 보존)
- --date YYYY-MM-DD (복수 지정 가능) : 해당 날짜의 data/temp/workers_<date>.json / zones_<date>.json 적재
  · 작업자별 → picking_worker_daily
  · 구역별   → picking_zone_daily

선행: scripts/picking_automation_v2.py --date <date> 실행으로 workers_/zones_ JSON 생성되어 있어야 함.

예) python scripts/load_picking_db.py --wipe --date 2026-06-01
"""
import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import execute_values

# Windows 콘솔 기본 코드페이지(cp949)로 실행 시(파이프로 리다이렉트되는 서브프로세스
# 체인 등) 특수문자 출력에서 UnicodeEncodeError로 죽는 문제 방지 (wms_rpa.py와 동일 처리)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
DB_URL = os.getenv("SUPABASE_POOLER_URL") or os.getenv("SUPABASE_DB_URL")

WIPE_TABLES = ["picking_worker_daily", "picking_zone_daily", "worker_daily", "zone_daily"]


def _conn():
    if not DB_URL:
        sys.exit("SUPABASE_POOLER_URL/SUPABASE_DB_URL 미설정")
    return psycopg2.connect(DB_URL)


def wipe(cur):
    # CBM/workers 마스터는 건드리지 않음
    tbls = ", ".join(WIPE_TABLES)
    print(f"[WIPE] TRUNCATE {tbls} ...")
    cur.execute(f"TRUNCATE TABLE {tbls} RESTART IDENTITY")
    print("  [완료] 실적 4개 테이블 비움 (workers, cbm_master 보존)")


def load_workers(cur, date_str):
    p = BASE_DIR / f"data/temp/workers_{date_str}.json"
    if not p.exists():
        print(f"  [skip] {p.name} 없음")
        return 0
    data = json.loads(p.read_text(encoding="utf-8"))
    # 멱등: 해당 날짜분 먼저 삭제 후 재삽입 (재실행 시 중복 방지)
    cur.execute("DELETE FROM picking_worker_daily WHERE work_date = %s", (date_str,))
    rows = [(d["work_date"], d["center"], d["owner"], d["zone"], d["worker_name"],
             d.get("shift"), d["pick_amount"], d["pick_box"],
             d.get("wave_time_hr"), d.get("wms_time_hr")) for d in data]
    execute_values(cur, """
        INSERT INTO picking_worker_daily
            (work_date, center, owner, zone, worker_name, shift,
             pick_amount, pick_box, wave_time_hr, wms_time_hr)
        VALUES %s
    """, rows)
    print(f"  [picking_worker_daily] {date_str}: {len(rows)}명 적재")
    return len(rows)


def load_zones(cur, date_str):
    p = BASE_DIR / f"data/temp/zones_{date_str}.json"
    if not p.exists():
        print(f"  [skip] {p.name} 없음")
        return 0
    data = json.loads(p.read_text(encoding="utf-8"))
    cur.execute("DELETE FROM picking_zone_daily WHERE work_date = %s", (date_str,))
    rows = [(d["work_date"], d["center"], d["owner"], d["zone"],
             d["pick_amount"], d["pick_box"],
             d.get("wave_time_hr"), d.get("wms_time_hr"))
            for d in data]
    execute_values(cur, """
        INSERT INTO picking_zone_daily
            (work_date, center, owner, zone,
             pick_amount, pick_box, wave_time_hr, wms_time_hr)
        VALUES %s
    """, rows)
    print(f"  [picking_zone_daily]   {date_str}: {len(rows)}구역 적재")
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wipe", action="store_true", help="실적 4개 테이블 TRUNCATE")
    ap.add_argument("--date", action="append", default=[], help="적재 날짜 (복수 가능)")
    args = ap.parse_args()

    conn = _conn()
    cur = conn.cursor()
    try:
        # wave_time_hr/wms_time_hr 컬럼 없으면 추가 (최초 1회).
        # std_time_hr/act_time_hr/efficiency는 가동률 개념 제거로 더 이상 안 씀 —
        # 과거 데이터 보존을 위해 컬럼 자체는 DROP하지 않음 (2026-09-28).
        cur.execute("ALTER TABLE picking_zone_daily   ADD COLUMN IF NOT EXISTS wms_time_hr  NUMERIC(10,4)")
        cur.execute("ALTER TABLE picking_worker_daily ADD COLUMN IF NOT EXISTS wms_time_hr  NUMERIC(10,4)")
        cur.execute("ALTER TABLE picking_zone_daily   ADD COLUMN IF NOT EXISTS wave_time_hr NUMERIC(10,4)")
        cur.execute("ALTER TABLE picking_worker_daily ADD COLUMN IF NOT EXISTS wave_time_hr NUMERIC(10,4)")
        if args.wipe:
            wipe(cur)
        for d in args.date:
            print(f"\n[적재] {d}")
            load_workers(cur, d)
            load_zones(cur, d)
        conn.commit()
        print("\n[COMMIT] 완료")

        # 적재 후 요약
        for t in ("picking_worker_daily", "picking_zone_daily"):
            cur.execute(f"SELECT work_date, COUNT(*) FROM {t} GROUP BY work_date ORDER BY work_date")
            summary = cur.fetchall()
            print(f"  {t}: " + ", ".join(f"{r[0]}={r[1]}" for r in summary))
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
