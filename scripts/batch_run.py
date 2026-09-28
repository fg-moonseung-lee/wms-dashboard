# -*- coding: utf-8 -*-
"""
picking_automation_v2.py 날짜별 배치 실행 + DB 적재

Usage:
  # 날짜 범위
  python scripts/batch_run.py --start 2026-06-01 --end 2026-06-30

  # 기존 zones JSON 있는 날짜만 재실행 (6월 backfill 용)
  python scripts/batch_run.py --start 2026-06-01 --end 2026-06-30 --existing-only

  # 특정 날짜들만
  python scripts/batch_run.py --dates 2026-06-12 2026-06-13

  # DB 적재 생략 (JSON만 재생성)
  python scripts/batch_run.py --start 2026-06-01 --end 2026-06-30 --existing-only --skip-db
"""
import argparse
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

# Windows 콘솔 기본 코드페이지(cp949)로 실행 시(파이프로 리다이렉트되는 서브프로세스
# 체인 등) 특수문자 출력에서 UnicodeEncodeError로 죽는 문제 방지 (wms_rpa.py와 동일 처리)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR  = Path(__file__).resolve().parent.parent
TEMP_DIR  = BASE_DIR / "data/temp"
DAILY_DIR = BASE_DIR / "data/daily"


def date_range(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def existing_dates(start: date, end: date) -> list[date]:
    """zones_DATE.json 이 이미 존재하는 날짜만 반환"""
    return [
        d for d in date_range(start, end)
        if (TEMP_DIR / f"zones_{d}.json").exists()
    ]


def archive_daily(d: date) -> None:
    """zones/workers JSON을 data/daily/YYYY-MM/ 에 복사"""
    import shutil
    dest_dir = DAILY_DIR / d.strftime("%Y-%m")
    dest_dir.mkdir(parents=True, exist_ok=True)
    for prefix in ("zones", "workers", "result"):
        src = TEMP_DIR / f"{prefix}_{d}.json"
        if src.exists():
            shutil.copy2(src, dest_dir / src.name)
    print(f"  [아카이브] {d} → data/daily/{d.strftime('%Y-%m')}/")


def run_one(d: date, from_master: bool, skip_db: bool) -> bool:
    date_str = str(d)

    # ── 자동화 실행 ──────────────────────────────────────────────
    cmd = [sys.executable, str(BASE_DIR / "scripts/picking_automation_v2.py"),
           "--date", date_str]
    if from_master:
        cmd.append("--from-master")

    t0 = time.time()
    ret = subprocess.run(cmd)
    elapsed = time.time() - t0

    if ret.returncode != 0:
        print(f"  [FAIL] {date_str}  자동화 오류 (exit={ret.returncode}, {elapsed:.0f}s)")
        return False
    print(f"  [자동화 완료] {date_str}  ({elapsed:.0f}s)")

    # ── 아카이브 ─────────────────────────────────────────────────
    archive_daily(d)

    # ── DB 적재 ─────────────────────────────────────────────────
    if not skip_db:
        cmd_db = [sys.executable, str(BASE_DIR / "scripts/load_picking_db.py"),
                  "--date", date_str]
        ret_db = subprocess.run(cmd_db, capture_output=True, text=True)
        if ret_db.returncode != 0:
            print(f"  [WARN]  {date_str}  DB 적재 실패")
            print(ret_db.stderr[:400] if ret_db.stderr else "")
        else:
            print(f"  [DB 적재] {date_str}  완료")

    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start",         default="2026-06-01", help="시작 날짜 YYYY-MM-DD")
    ap.add_argument("--end",           default="2026-06-30", help="종료 날짜 YYYY-MM-DD")
    ap.add_argument("--dates",         nargs="*",            help="특정 날짜 리스트 (--start/--end 대신)")
    ap.add_argument("--existing-only", action="store_true",  help="zones JSON 있는 날짜만 처리")
    ap.add_argument("--from-master",   action="store_true",  help="picking_automation --from-master 전달")
    ap.add_argument("--skip-db",       action="store_true",  help="DB 적재 생략")
    args = ap.parse_args()

    # 처리 날짜 목록 결정
    if args.dates:
        date_list = [datetime.strptime(d, "%Y-%m-%d").date() for d in args.dates]
    else:
        start = datetime.strptime(args.start, "%Y-%m-%d").date()
        end   = datetime.strptime(args.end,   "%Y-%m-%d").date()
        if args.existing_only:
            date_list = existing_dates(start, end)
        else:
            date_list = list(date_range(start, end))

    total = len(date_list)
    if total == 0:
        print("처리 대상 날짜 없음")
        return

    print(f"처리 대상: {total}개 날짜")
    print(f"  {date_list[0]} ~ {date_list[-1]}")
    if args.existing_only:
        print("  (기존 zones JSON 있는 날짜만)")
    print()

    ok, fail = [], []
    total_start = time.time()

    for i, d in enumerate(date_list, 1):
        print(f"[{i}/{total}] {d}")
        success = run_one(d, from_master=args.from_master, skip_db=args.skip_db)
        if success:
            ok.append(str(d))
        else:
            fail.append(str(d))

        elapsed_total = time.time() - total_start
        remaining = len(date_list) - i
        avg = elapsed_total / i
        eta_min = avg * remaining / 60
        print(f"  진행: {i}/{total}  경과: {elapsed_total/60:.1f}분  남은예상: {eta_min:.0f}분\n")

    print("=" * 60)
    print(f"완료: {len(ok)}개  |  실패: {len(fail)}개  |  총 {(time.time()-total_start)/60:.1f}분")
    if ok:
        print(f"성공: {', '.join(ok)}")
    if fail:
        print(f"실패: {', '.join(fail)}")


if __name__ == "__main__":
    main()
