# -*- coding: utf-8 -*-
"""
입고 실적 배치 실행: 브랜드별 자동화 → 일자별 아카이브(병합) → DB 적재

  1. 브랜드별로 inbound_automation.py --no-verify 실행 (raw 있는 브랜드만)
  2. 결과 JSON(data/temp/inbound_<brand>_<date>.json)을 하나로 병합해
     data/daily/<YYYY-MM>/inbound_<date>.json 로 아카이브 (피킹의 zones_<date>.json과 같은 성격)
  3. load_inbound_db.py 로 DB 적재

Usage:
  python scripts/inbound_batch_run.py --dates 2026-07-01 2026-07-02
  python scripts/inbound_batch_run.py --start 2026-07-01 --end 2026-07-06
  python scripts/inbound_batch_run.py --dates 2026-07-06 --brands 일룸 데스커   (일부 브랜드만)
  python scripts/inbound_batch_run.py --dates 2026-07-06 --skip-db            (DB 적재 생략)
"""
import argparse
import json
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Windows 콘솔 기본 코드페이지(cp949)로 실행 시(파이프로 리다이렉트되는 서브프로세스
# 체인 등) 특수문자 출력에서 UnicodeEncodeError로 죽는 문제 방지 (wms_rpa.py와 동일 처리)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR  = Path(__file__).resolve().parent.parent
TEMP_DIR  = BASE_DIR / "data" / "temp"
DAILY_DIR = BASE_DIR / "data" / "daily"
RAW_BASE  = BASE_DIR / "data" / "raw" / "2026_입고"

ALL_BRANDS = ["일룸", "데스커", "퍼시스", "3PL"]


def date_range(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def has_raw(brand: str, d: date) -> bool:
    """입고/이동 raw 중 하나라도 있으면 처리 대상 — 명절 등 정상입고 없이
    이동(피킹 준비용 재배치)만 있는 날도 있음(2026-09-24 추석 등)."""
    mmdd = d.strftime("%m%d")
    folder = RAW_BASE / d.strftime("%m")
    return (folder / f"입고_{brand}_{mmdd}.xlsx").exists() or \
           (folder / f"이동_{brand}_{mmdd}.xlsx").exists()


def run_automation(brand: str, d: date) -> bool:
    cmd = [sys.executable, str(BASE_DIR / "scripts/inbound_automation.py"),
           "--date", str(d), "--brand", brand, "--no-verify"]
    ret = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if ret.returncode != 0:
        print(f"    [FAIL] {brand} {d}")
        print(ret.stderr[-500:] if ret.stderr else ret.stdout[-500:])
        return False
    return True


def archive_daily(d: date, brands: list[str]) -> int:
    """브랜드별 temp JSON을 하나로 병합해 data/daily/<YYYY-MM>/inbound_<date>.json 저장"""
    merged = []
    for brand in brands:
        p = TEMP_DIR / f"inbound_{brand}_{d}.json"
        if not p.exists():
            continue
        merged.extend(json.loads(p.read_text(encoding="utf-8")))

    dest_dir = DAILY_DIR / d.strftime("%Y-%m")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"inbound_{d}.json"
    dest.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  [아카이브] {d} → {dest.relative_to(BASE_DIR)} ({len(merged)}건)")
    return len(merged)


def load_db(d: date, brands: list[str]):
    cmd = [sys.executable, str(BASE_DIR / "scripts/load_inbound_db.py"),
           "--brand", *brands, "--date", str(d)]
    ret = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if ret.returncode != 0:
        print(f"  [WARN] {d} DB 적재 실패")
        print(ret.stderr[-500:] if ret.stderr else ret.stdout[-500:])
    else:
        print(f"  [DB 적재] {d} 완료")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dates",  nargs="+", help="특정 날짜들 (YYYY-MM-DD)")
    ap.add_argument("--start",  help="시작 날짜 (--dates 대신 범위 지정)")
    ap.add_argument("--end",    help="종료 날짜")
    ap.add_argument("--brands", nargs="+", default=ALL_BRANDS, help="대상 브랜드 (기본: 전체)")
    ap.add_argument("--skip-db", action="store_true", help="DB 적재 생략 (아카이브만)")
    args = ap.parse_args()

    if args.dates:
        dates = sorted(datetime.strptime(d, "%Y-%m-%d").date() for d in args.dates)
    elif args.start and args.end:
        dates = list(date_range(
            datetime.strptime(args.start, "%Y-%m-%d").date(),
            datetime.strptime(args.end, "%Y-%m-%d").date(),
        ))
    else:
        ap.error("--dates 또는 --start/--end 필요")

    print(f"처리 대상: {len(dates)}개 날짜 × {len(args.brands)}개 브랜드\n")

    for d in dates:
        print(f"[{d}]")
        available = [b for b in args.brands if has_raw(b, d)]
        skipped = set(args.brands) - set(available)
        if skipped:
            print(f"  [SKIP] raw 없음: {', '.join(sorted(skipped))}")
        if not available:
            print("  처리할 브랜드 없음\n")
            continue

        ok_brands = []
        for brand in available:
            print(f"  {brand} 자동화 실행...")
            if run_automation(brand, d):
                ok_brands.append(brand)

        if ok_brands:
            archive_daily(d, ok_brands)
            if not args.skip_db:
                load_db(d, ok_brands)
        print()

    print("완료")


if __name__ == "__main__":
    main()
