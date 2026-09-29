# -*- coding: utf-8 -*-
"""
피킹↔입고 겸업 시간 안분 (2026-09-29)

한 작업자가 피킹하다가 입고 지원을 갔다가 복귀하면, 기존 wms_time_hr(그 구역의
첫 픽~마지막 픽 전체 span) 계산은 입고 지원 시간까지 그 구역 picking 시간으로
그대로 얹어서 부풀린다. 이 스크립트는 그날 이미 다운로드된 raw 엑셀(재다운로드
없음)에서 피킹 타임스탬프와 입고(입고+이동) 타임스탬프를 작업자별로 합쳐 시간순
정렬한 뒤, "직전 이벤트와 기능(피킹/입고)+구역(또는 브랜드)이 같으면 같은 연속
구간으로 잇고, 바뀌면 새 구간을 시작"하는 방식으로 실측 대조한다 — 공백 길이를
추측하는 게 아니라, 그 공백 동안 실제로 다른 쪽 raw에 타임스탬프가 있는지로
판정하므로 대기시간(어느 쪽에도 안 잡힘)과 지원근무(그 쪽 raw에 잡힘)가 자연히
구분된다.

재계산 결과로 picking_worker_daily.wms_time_hr / picking_zone_daily.wms_time_hr /
inbound_worker_daily.hours / inbound_brand_daily.hours를 갱신한다(1차 적재가 끝난
뒤 실행하는 후처리 단계 — DELETE+INSERT가 아니라 UPDATE).

DPS 구역은 _build()가 개별 작업자명을 전부 "DPS"로 묶어버려(zone 전체를 하나의
가상 작업자로 취급) 개인 대 개인 대조가 불가능 — 이번 안분 대상에서 제외하고
기존 계산값을 그대로 둔다.

Usage:
  python scripts/reconcile_cross_function.py --date 2026-09-27
"""
import argparse
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import pandas as pd
import psycopg2
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
DB_URL = os.getenv("SUPABASE_POOLER_URL") or os.getenv("SUPABASE_DB_URL")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from picking_automation_v2 import _build_daily_frames          # noqa: E402
from inbound_automation import load_inbound, load_moves, BRANDS, strip_tag  # noqa: E402


def _conn():
    if not DB_URL:
        sys.exit("SUPABASE_POOLER_URL/SUPABASE_DB_URL 미설정")
    return psycopg2.connect(DB_URL)


def _load_picking_events(target) -> pd.DataFrame:
    """(zone, worker, ts) — DPS 제외, worker는 태그 제거된 표시 이름."""
    sd_f1, sd_i1, sd_d1, sd_du1 = _build_daily_frames(target)
    frames = [sd[["B", "J", "K"]].rename(columns={"B": "zone", "J": "worker_raw", "K": "ts"})
              for sd in (sd_f1, sd_i1, sd_d1, sd_du1) if not sd.empty]
    if not frames:
        return pd.DataFrame(columns=["zone", "worker", "ts"])
    df = pd.concat(frames, ignore_index=True)
    df = df[df["zone"] != "DPS"]
    df["worker"] = df["worker_raw"].map(strip_tag)
    return df[["zone", "worker", "ts"]]


def _load_inbound_events(target) -> pd.DataFrame:
    """(brand, worker, ts) — worker는 태그 제거된 표시 이름."""
    frames = []
    for brand in BRANDS:
        for loader in (load_inbound, load_moves):
            d = loader(brand, target)
            if d.empty:
                continue
            sub = d[["worker", "work_dt"]].rename(columns={"work_dt": "ts"}).copy()
            sub["brand"] = brand
            frames.append(sub)
    if not frames:
        return pd.DataFrame(columns=["brand", "worker", "ts"])
    df = pd.concat(frames, ignore_index=True)
    df["worker"] = df["worker"].map(strip_tag)
    return df[["brand", "worker", "ts"]]


def reconcile(target):
    """작업자별로 피킹+입고 이벤트를 합쳐 실제 연속 활동 구간만 합산.

    반환: (picking_wms: {(zone, worker): hours}, inbound_hours: {(brand, worker): hours})
    """
    picking = _load_picking_events(target)
    inbound = _load_inbound_events(target)

    picking = picking.assign(func="피킹", key=picking["zone"]) if not picking.empty \
        else pd.DataFrame(columns=["worker", "ts", "func", "key"])
    inbound = inbound.assign(func="입고", key=inbound["brand"]) if not inbound.empty \
        else pd.DataFrame(columns=["worker", "ts", "func", "key"])

    combined = pd.concat([
        picking[["worker", "ts", "func", "key"]],
        inbound[["worker", "ts", "func", "key"]],
    ], ignore_index=True)

    picking_wms: dict = defaultdict(float)
    inbound_hours: dict = defaultdict(float)
    cross_workers = set()

    for worker, g in combined.groupby("worker"):
        g = g.sort_values("ts").reset_index(drop=True)
        has_picking = (g["func"] == "피킹").any()
        has_inbound = (g["func"] == "입고").any()
        if has_picking and has_inbound:
            cross_workers.add(worker)

        # run 경계는 "기능"(피킹/입고) 전환만 기준으로 삼는다 — 구역/브랜드는 경계가
        # 아니다. 같은 피킹 안에서 인접 구역을 몇 분 단위로 옮겨다니는 건 정상적인
        # 연속 근무이지, 입고 지원 같은 기능 전환이 아니기 때문(실사례로 확인:
        # 2026-09-27 장광일이 H-I/A-P를 몇 분 간격으로 계속 오갔는데, 구역까지
        # 경계로 삼으면 이 정상 근무가 잘게 쪼개져 각 구역 WMS시간이 왜곡됨).
        # 한 기능 run 안에서 여러 구역/브랜드를 오갔으면, 그 run 범위 안에서만
        # 구역/브랜드별로 다시 min-max — 기능 전환이 아예 없는 날은 이 run이 하루
        # 전체 하나뿐이라 기존 "하루 전체 구역별 min-max" 방식과 결과가 동일하다.
        run_id = (g["func"] != g["func"].shift()).cumsum()
        for _, rg in g.groupby(run_id):
            func = rg["func"].iloc[0]
            target = picking_wms if func == "피킹" else inbound_hours
            for key, kg in rg.groupby("key"):
                span_hr = (kg["ts"].max() - kg["ts"].min()).total_seconds() / 3600
                target[(key, worker)] += span_hr

    return dict(picking_wms), dict(inbound_hours), cross_workers


def write_db(conn, target, picking_wms, inbound_hours):
    date_str = str(target)
    cur = conn.cursor()

    cur.execute("SELECT id, zone, worker_name FROM picking_worker_daily WHERE work_date=%s", (date_str,))
    n_picking = 0
    for id_, zone, worker_name in cur.fetchall():
        val = picking_wms.get((zone, strip_tag(worker_name)))
        if val is not None:
            cur.execute("UPDATE picking_worker_daily SET wms_time_hr=%s WHERE id=%s", (round(val, 6), id_))
            n_picking += 1

    cur.execute("""
        SELECT zone, SUM(wms_time_hr) FROM picking_worker_daily
        WHERE work_date=%s GROUP BY zone
    """, (date_str,))
    for zone, total in cur.fetchall():
        cur.execute(
            "UPDATE picking_zone_daily SET wms_time_hr=%s WHERE work_date=%s AND zone=%s",
            (total, date_str, zone),
        )

    cur.execute("SELECT id, brand, worker_display FROM inbound_worker_daily WHERE work_date=%s", (date_str,))
    n_inbound = 0
    for id_, brand, worker_display in cur.fetchall():
        val = inbound_hours.get((brand, worker_display))
        if val is not None:
            cur.execute("UPDATE inbound_worker_daily SET hours=%s WHERE id=%s", (round(val, 6), id_))
            n_inbound += 1

    cur.execute("""
        SELECT brand, SUM(hours) FROM inbound_worker_daily
        WHERE work_date=%s GROUP BY brand
    """, (date_str,))
    for brand, total in cur.fetchall():
        cur.execute(
            "UPDATE inbound_brand_daily SET hours=%s WHERE work_date=%s AND brand=%s",
            (total, date_str, brand),
        )

    conn.commit()
    cur.close()
    return n_picking, n_inbound


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", required=True, help="YYYY-MM-DD")
    args = ap.parse_args()
    target = datetime.strptime(args.date, "%Y-%m-%d").date()

    print(f"=== 피킹↔입고 겸업 시간 안분 {target} ===")
    picking_wms, inbound_hours, cross_workers = reconcile(target)

    total_picking = sum(picking_wms.values())
    total_inbound = sum(inbound_hours.values())
    print(f"  피킹 WMS시간 합계: {total_picking:.2f}h ({len(picking_wms)}건)")
    print(f"  입고 시간 합계:    {total_inbound:.2f}h ({len(inbound_hours)}건)")
    if cross_workers:
        print(f"  겸업(피킹+입고 동시) 작업자 {len(cross_workers)}명: {', '.join(sorted(cross_workers))}")
    else:
        print("  겸업 작업자 없음 — 이번 안분은 사실상 회귀 확인용")

    conn = _conn()
    try:
        n_picking, n_inbound = write_db(conn, target, picking_wms, inbound_hours)
        print(f"  [DB 갱신] picking_worker_daily {n_picking}건, inbound_worker_daily {n_inbound}건")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
