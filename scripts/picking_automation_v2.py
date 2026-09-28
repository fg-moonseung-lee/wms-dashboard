"""
picking_automation_v2.py  –  피킹 생산성 자동화 (v3)

Usage:
  python scripts/picking_automation_v2.py --date 2026-05-12

변경 이력:
  v3: F_1/D_1/DU_1 V열(22) 처리 추가, 정렬 WAVE번호(H) 기준으로 통일
"""

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import execute_values

# Windows 콘솔 기본 코드페이지(cp949)로 실행 시(파이프로 리다이렉트되는 서브프로세스
# 체인 등) 특수문자 출력에서 UnicodeEncodeError로 죽는 문제 방지 (wms_rpa.py와 동일 처리)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ── 경로 ─────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
load_dotenv(BASE_DIR / ".env")

MASTER1 = BASE_DIR / "data/master/기준정보_마스터.xlsx"
MASTER2 = BASE_DIR / "data/master/기준정보2_마스터.xlsx"
TEMP1   = BASE_DIR / "data/temp/tmp_master1.xlsx"
TEMP2   = BASE_DIR / "data/temp/tmp_master2.xlsx"
RAW_DIR = BASE_DIR / "data/raw"

LOC_MASTER1 = BASE_DIR / "data/master/양지1센터_로케이션_정보.xlsx"
LOC_MASTER2 = BASE_DIR / "data/master/양지2센터_로케이션_정보.xlsx"
LOC_MASTER3 = BASE_DIR / "data/master/양지3센터_로케이션_정보.xlsx"
PRICE_MASTER = BASE_DIR / "data/master/기준정보_공장도가.xlsx"

SUPABASE_URL = os.getenv("SUPABASE_POOLER_URL", os.getenv("SUPABASE_DB_URL", ""))

# ── 상수 ─────────────────────────────────────────────────────────────
_REGION_RE = re.compile(r'경\d{2}-|광주\d{2}-|전남\d{3}-')
_3PL_EXCL  = {
    # 수동 다운로드 파일 기준 (한국어 오너명)
    "퍼시스", "일룸", "데스커", "시디즈", "알로소", "슬로우베드",
    # RPA API 다운로드 기준 (WMS 오너 코드)
    "T60I01", "T60I02", "T60I03",   # 일룸/슬로우베드
    "T60F01",                        # 퍼시스
    "T60P01", "T60P02",              # 시디즈(T60P01), 알로소(T60P02)
}
_VALID_Z1  = {"A-P", "B", "C-D", "E-F", "H-I", "J-K", "L", "L/S", "P/S"}
_ZONE2_MAP = {"M": "M-N", "N": "M-N", "S": "S"}
_ZONE3_MAP = {"W": "W", "R": "R", "T1": "R", "T3": "R", "T4": "R"}

# 종합실적 D열 위치 (1-indexed): (표준시간 행, 실적시간 행)
ZONE_ROWS_1 = {
    "H-I": (10,  21),  "C-D": (34,  45),  "A-P": (58,  69),
    "DPS": (106, 117),
    "E-F": (188, 199), "J-K": (212, 223), "L":   (236, 247),
    "B":   (260, 271), "L/S": (284, 295),
}
ZONE_ROWS_2 = {
    "M-N": (10,  21), "S": (34,  45),
    "W":   (188, 199), "R": (212, 223),
}

# 피킹실적 C열 작업자 슬롯 (1-indexed, 양끝 포함)
PICKING_SLOTS_1 = {
    "H-I": (7,   56),  "C-D": (58,  107), "A-P": (109, 158),
    "DPS": (167, 216),
    "E-F": (227, 276), "J-K": (278, 327), "L":   (329, 378),
    "B":   (380, 429), "L/S": (431, 480),
}
PICKING_SLOTS_2 = {
    "M-N": (7,   56),  "S":   (58,  107),
    "W":   (118, 167), "R":   (169, 218),
}

ZONE_OWNER = {
    "H-I": "일룸",   "C-D": "일룸",   "A-P": "일룸",   "DPS": "일룸",
    "E-F": "퍼시스", "J-K": "퍼시스", "L":   "퍼시스", "B":   "퍼시스", "L/S": "퍼시스",
    "M-N": "데스커", "S":   "데스커",
    "W":   "3PL",    "R":   "3PL",
}

ZONE_CENTER = {
    "H-I": "양지1센터", "C-D": "양지1센터", "A-P": "양지1센터", "DPS": "양지1센터",
    "E-F": "양지1센터", "J-K": "양지1센터", "L":   "양지1센터", "B":   "양지1센터", "L/S": "양지1센터",
    "M-N": "양지2센터", "S":   "양지2센터",
    "W":   "양지3센터", "R":   "양지3센터",
}

# ── 로케이션 마스터 로드 ──────────────────────────────────────────────
_loc_cache: dict = {}

def _load_loc_map(path: Path) -> dict:
    key = str(path)
    if key in _loc_cache:
        return _loc_cache[key]
    df = pd.read_excel(path, usecols=[2, 3], header=0)
    df.columns = ["zone", "loc_id"]
    m = {
        str(r.loc_id).strip(): str(r.zone).strip()
        for r in df.itertuples()
        if pd.notna(r.loc_id) and pd.notna(r.zone)
    }
    _loc_cache[key] = m
    return m


# ── zone 매핑 ────────────────────────────────────────────────────────
# lm1 미등록 위치(신규 랙 등)를 위한 prefix 기반 fallback
# (비교 분석 결과: 마스터에는 있고 우리에 없는 행이 lm 미등록 위치에 집중됨)
_Z1_PREFIX_FALLBACK = {
    "A": "A-P",
    "B": "B",
    "C": "C-D", "D": "C-D",
    "E": "E-F",  "F": "E-F",
    "G": "J-K",  # G랙(G-1xx 등)은 J-K zone (퍼시스 소물)
    "H": "H-I",  "I": "H-I",
    "J": "J-K",  "K": "J-K",
    "L": "L",    # L/S는 lm1에 있는 위치만 해당 → 미등록 L-XXX는 L로 처리
}

# 로케이션 마스터 오류 보정: 마스터에 잘못 등록된 zone 값 override
_Z1_ZONE_OVERRIDE: dict[str, str] = {
    "F-102-26":  "E-F",  # 마스터 오류: B로 분류됨, 실제 F구역 → E-F
    "L-103-05-4": "L",  # 마스터 오류: L/S로 분류됨, 실제 L구역
    "L-103-16-4": "L",  # 마스터 오류: L/S로 분류됨, 실제 L구역
}


def _zone1(loc: str, lm: dict) -> str | None:
    """양지1센터: 일룸(H-I,C-D,A-P,DPS) + 퍼시스(E-F,J-K,L,B,L/S)"""
    if not loc or not isinstance(loc, str):
        return None
    loc = loc.strip()
    if re.match(r'^Y-REC', loc, re.IGNORECASE):
        return None
    override = _Z1_ZONE_OVERRIDE.get(loc)
    if override:
        return override
    if re.match(r'^P-110', loc, re.IGNORECASE):
        return "A-P"  # P-110은 단가상 H-I이나 생산성 기준으로는 A-P로 처리
    m = re.match(r'^P-(\d+)', loc, re.IGNORECASE)
    if m and int(m.group(1)) >= 300:
        return "P/S"
    raw = lm.get(loc)
    if not raw:
        # lm1 미등록: prefix 기반 fallback (L-106-08-1 → "L" 등)
        prefix = loc.split("-")[0].upper() if "-" in loc else loc[0].upper()
        fb = _Z1_PREFIX_FALLBACK.get(prefix)
        if fb:
            return fb
        # P-XXX (XXX < 300, 110 이외): A-P fallback
        if re.match(r'^P-(\d+)', loc, re.IGNORECASE):
            return "A-P"
        return None
    cleaned = re.sub(r'\(반품\)', '', raw).strip()
    if cleaned in _VALID_Z1:
        return cleaned
    # lm1값이 단순 prefix 문자(예: "G")여서 유효 zone이 아닌 경우 → prefix fallback 시도
    # 예: lm1["G-100-04-1"] = "G" → _Z1_PREFIX_FALLBACK["G"] = "J-K"
    prefix = cleaned[0].upper() if cleaned else (loc.split("-")[0].upper() if "-" in loc else loc[0].upper())
    fb = _Z1_PREFIX_FALLBACK.get(prefix)
    return fb  # None이면 None 반환


def _zone2(loc: str, lm: dict) -> str | None:
    """양지2센터: 데스커(M-N, S)"""
    if not loc or not isinstance(loc, str):
        return None
    loc = loc.strip()
    raw = lm.get(loc)
    if not raw:
        # lm2 미등록: prefix 기반 fallback (M-118-XX → "M-N" 등)
        prefix = loc.split("-")[0].upper() if "-" in loc else loc[0].upper()
        if prefix in ("M", "N"):
            return "M-N"
        if prefix == "S":
            return "S"
        return None
    cleaned = re.sub(r'\(반품\)|\(보관\)', '', raw).strip()
    return _ZONE2_MAP.get(cleaned)


def _zone3(loc: str, lm: dict) -> str | None:
    """양지3센터: 3PL(W, R)"""
    if not loc or not isinstance(loc, str):
        return None
    raw = lm.get(loc.strip())
    if not raw:
        return None
    return _ZONE3_MAP.get(raw.strip())


# ── raw 파일 탐색 ────────────────────────────────────────────────────
def find_raw(target: date, owner: str) -> Path | None:
    mmdd = target.strftime("%m%d")
    nxdd = (target + timedelta(days=1)).strftime("%m%d")
    d = RAW_DIR / target.strftime("%Y/%m")
    patterns = {
        "퍼시스": [f"퍼시스_{mmdd}.xlsx"],
        "일룸":   [f"일룸_{mmdd}_{nxdd}.xlsx", f"일룸_{mmdd}*.xlsx"],
        "데스커": [f"데스커_{mmdd}_{nxdd}.xlsx", f"데스커_{mmdd}*.xlsx"],
        "3PL":    [f"3PL_{mmdd}.xlsx", f"3PL_{mmdd}*.xlsx", f"3센터_{mmdd}.xlsx"],
    }
    for pat in patterns.get(owner, []):
        hits = sorted(glob.glob(str(d / pat)))
        if hits:
            return Path(hits[0])
    return None


# ── raw 로드 / 필터 ──────────────────────────────────────────────────
def _load_raw(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path)
    # 앞뒤 공백 제거 + 내부 공백 언더스코어로 통일 ('ITEM ID' → 'ITEM_ID', 'PLT ID' → 'PLT_ID')
    df.columns = df.columns.str.strip().str.replace(r'\s+', '_', regex=True)
    # 작업일시 파싱 문제 수정:
    # '2026-05-12T11:21:05.907' (밀리초 O) vs '2026-05-12T11:21:05' (밀리초 X) 혼재 시
    # pandas가 밀리초 포함 형식을 열 전체에 고정 추론하여 밀리초 없는 행을 NaT 처리.
    # → format="mixed" (pandas 2.0+): 각 값을 개별 파싱
    # → 구버전 fallback: 1차 파싱 후 NaT 행만 재파싱
    raw_col = df["작업일시"].astype(str).str.replace("T", " ", regex=False)
    try:
        df["작업일시"] = pd.to_datetime(raw_col, errors="coerce", format="mixed")
    except TypeError:
        # pandas < 2.0: format="mixed" 미지원
        df["작업일시"] = pd.to_datetime(raw_col, errors="coerce")
        nat_mask = df["작업일시"].isna()
        if nat_mask.any():
            # NaT 행만 재시도 (infer_datetime_format=False로 형식 고정 방지)
            df.loc[nat_mask, "작업일시"] = pd.to_datetime(
                raw_col[nat_mask], errors="coerce", infer_datetime_format=False
            )
    return df.dropna(subset=["작업일시"])


def _parse_file_end_date(path, t: date) -> date:
    """파일명 마지막 _NNDD 토큰에서 종료 날짜 파싱.

    예) 일룸_0602_0604.xlsx → 2026-06-04
        일룸_0601_0602.xlsx → 2026-06-02 (평상시)
        일룸_0605_0608.xlsx → 2026-06-08 (연속공휴일 후)
    파싱 실패 시 t+1(평상시 기본값) 반환.
    """
    if path is None:
        return t + timedelta(days=1)
    stem = Path(path).stem  # e.g., '일룸_0602_0604'
    parts = stem.split('_')
    if len(parts) >= 3:
        end_mmdd = parts[-1]
        if len(end_mmdd) == 4:
            try:
                m, d = int(end_mmdd[:2]), int(end_mmdd[2:])
                return date(t.year, m, d)
            except (ValueError, TypeError):
                pass
    return t + timedelta(days=1)


def _i1_d1_window(t: date, raw_path):
    """일룸/데스커 주간·야간 타임스탬프 범위 반환 (day_start, day_end, night_start, night_end).

    파일명의 종료 날짜(NNDD)로 야간 윈도우 결정:
    - 평상시 NNDD = t+1  → 야간 = t 21:00 ~ (t+1) 08:00
    - 공휴일 전날 NNDD > t+1 → 야간 = (NNDD-1) 21:00 ~ NNDD 08:00
      예) 일룸_0602_0604.xlsx: 야간 = 6/3 21:00 ~ 6/4 08:00 (6/3 공휴일 야간투입)
          일룸_0605_0608.xlsx: 야간 = 6/7 21:00 ~ 6/8 08:00 (연속공휴일 후 야간투입)
    """
    ts = pd.Timestamp(t)
    day_start   = ts.replace(hour=8,  minute=0,  second=0)
    day_end     = ts.replace(hour=20, minute=59, second=59)
    end_date    = _parse_file_end_date(raw_path, t)
    ts_end      = pd.Timestamp(end_date)
    ts_prev     = ts_end - pd.Timedelta(days=1)
    night_start = ts_prev.replace(hour=21, minute=0, second=0)
    night_end   = ts_end.replace(hour=8,  minute=0, second=0)
    return day_start, day_end, night_start, night_end


def _filter_f1(df: pd.DataFrame, t: date, raw_path=None) -> pd.DataFrame:
    """퍼시스: 주간(08:01~20:59), Y-REC 제외"""
    ts = pd.Timestamp(t)
    df = df[df["작업일시"].between(
        ts.replace(hour=8, minute=1, second=0),
        ts.replace(hour=20, minute=59, second=59),
    )]
    return df[~df["LOCATION"].astype(str).str.upper().str.startswith("Y-REC")]


def _filter_i1(df: pd.DataFrame, t: date, raw_path=None) -> pd.DataFrame:
    """일룸: 주간 + 야간, Y-REC 제외, [주간]/[야간] 태그 필수 (DPS P-3XX 예외).

    파일명 종료 날짜(_NNDD)로 야간 윈도우 동적 결정 — _i1_d1_window 참조.
    """
    day_start, day_end, night_start, night_end = _i1_d1_window(t, raw_path)
    mask = df["작업일시"].between(day_start, day_end) | df["작업일시"].between(night_start, night_end)
    out  = df[mask & ~df["LOCATION"].astype(str).str.upper().str.startswith("Y-REC")].copy()
    tagged  = out["작업자"].astype(str).str.match(r"^\[(주간|야간)\]")
    dps_loc = out["LOCATION"].astype(str).apply(
        lambda loc: bool(re.match(r"^P-(\d+)", loc, re.I))
                    and int(re.match(r"^P-(\d+)", loc, re.I).group(1)) >= 300
    )
    # DPS(P-3XX)는 주간만 포함 — 야간 DPS는 다음날 업무일자에 귀속
    dps_day = out["작업일시"].between(day_start, day_end)
    return out[tagged | (dps_loc & dps_day)]


def _filter_d1(df: pd.DataFrame, t: date, raw_path=None) -> pd.DataFrame:
    """데스커: 주간 + 야간, Y-REC 제외.

    파일명 종료 날짜(_NNDD)로 야간 윈도우 동적 결정 — _i1_d1_window 참조.
    주간/야간 판단:
    - [주간] 태그: day_start 이후 시간 제한 없이 주간으로 포함
      (22시까지 wave 연장 케이스 처리 — 퇴근 전 wave 완료까지 주간 귀속)
    - [야간] 태그: night_start - 1h(20:00)부터 허용 (얼리스타트)
                  night_end(08:00) 이후여도 09:00 이전이면 전날 야간 귀속
                  (마무리 wave가 08시를 넘겨도 야간 작업자라면 전날 실적)
    - 무태그: night_start(21:00) 이후라면 야간 연장으로 인정
    """
    day_start, day_end, night_start, night_end = _i1_d1_window(t, raw_path)
    night_start_early = night_start - pd.Timedelta(hours=1)
    # [야간] 태그 전용 야간 종료: 09:00 이전까지 전날 야간으로 처리
    night_end_tag = pd.Timestamp(night_end).replace(hour=9, minute=0, second=0)
    no_yrec = ~df["LOCATION"].astype(str).str.upper().str.startswith("Y-REC")
    is_night_tag = df["작업자"].astype(str).str.match(r"^\[야간\]")
    is_day_tag   = df["작업자"].astype(str).str.match(r"^\[주간\]")
    # [주간] 태그는 당일 23:59까지 허용 (22시 연장 wave 처리); 무태그는 day_end(20:59)까지
    day_tag_end  = pd.Timestamp(t).replace(hour=23, minute=59, second=59)
    # 주간: [주간] 태그는 day_start~23:59 / 무태그는 day_start~day_end(20:59)
    mask_day = (
        (df["작업일시"].between(day_start, day_end) & ~is_night_tag) |
        (df["작업일시"].between(day_start, day_tag_end) & is_day_tag)
    )
    # 야간: [야간] 태그는 얼리스타트(20:00)~09:00 / 무태그(비[주간])는 21:00~08:00
    mask_night = (
        (df["작업일시"].between(night_start_early, night_end_tag) & is_night_tag) |
        (df["작업일시"].between(night_start, night_end) & ~is_night_tag & ~is_day_tag)
    )
    return df[(mask_day | mask_night) & no_yrec].copy()


def _filter_du1(df: pd.DataFrame, t: date, raw_path=None) -> pd.DataFrame:
    """3PL: 주간(08:01~20:59), 그룹사(퍼시스/일룸 등) OWNER 제외, Y-REC 제외.

    날짜 경계를 두지 않고 시간대만 필터 — RPA가 다운로드 범위를
    (target ~ 다음근무일-1)로 이미 제한하므로 파일 내 모든 날짜가
    주말·공휴일 합산 대상이 될 수 있음.
    그룹사리스트(_3PL_EXCL)는 KGA 파일에 넣을 때 제거한다 — 기준 마스터 기준 R=7.2018hr 일치 확인.
    """
    h = df["작업일시"].dt.hour
    m = df["작업일시"].dt.minute
    in_window = ((h > 8) | ((h == 8) & (m >= 1))) & (h <= 20)
    df = df[in_window]
    df = df[~df["LOCATION"].astype(str).str.upper().str.startswith("Y-REC")]
    return df[~df["OWNER"].astype(str).isin(_3PL_EXCL)]


# ── 위치 보정 테이블 (raw 데이터 입력 오류 보정) ────────────────────
# I_1 (일룸) 전용: B구역 위치는 C-D zone 치환
# "일룸에 B구역이 저거 하나" — B-109-01-1 피킹은 실제 C-103-01-1 위치
_I1_LOC_CORRECTIONS: dict[str, str] = {
    "B-109-01-1": "C-103-01-1",
}

# ── 시트 데이터 빌드 ─────────────────────────────────────────────────
def _to_int_str(v) -> str:
    """숫자형 .0 suffix 제거 ('55.0'→'55', '202606010227.0'→'202606010227').
    문자열은 그대로 반환 ('00'→'00', leading zero 보존).
    """
    if v is None:
        return ''
    if isinstance(v, float):
        if pd.isna(v):
            return ''
        if v == int(v):
            return str(int(v))
        return str(v)
    if isinstance(v, int):
        return str(v)
    return str(v)  # str 그대로 ('00' → '00')


def _build(df: pd.DataFrame, zone_fn, fixed_region: str | None = None,
           loc_corrections: dict | None = None,
           last_zones: list | None = None) -> pd.DataFrame:
    """
    raw 행 → 시트 레코드 변환 + 정렬

    정렬 기준 (가동률-로데이터 입력,변환 파일 기준):
      일반 구역: J(작업자) > K(작업일시) > I(WAVE명) > G(PLT_ID) > F(LOCATION)
      DPS:       J(작업자) > I(WAVE명)   > G(PLT_ID) > K(작업일시) > F(LOCATION)

    last_zones: 마스터에서 항상 맨 뒤에 붙는 구역 목록
      F_1=['L/S'], I_1=['DPS'], D_1=['S'], DU_1=[]
    """
    if last_zones is None:
        last_zones = ['DPS']

    records = []
    for _, row in df.iterrows():
        loc  = str(row.get("LOCATION", ""))
        if loc_corrections and loc in loc_corrections:
            loc = loc_corrections[loc]
        zone = zone_fn(loc)
        if zone is None:
            continue
        worker    = str(row.get("작업자", ""))
        wave_name = str(row.get("WAVE명", ""))
        region    = fixed_region or ("지방" if _REGION_RE.search(wave_name) else "소액")
        if zone == "P/S":
            zone   = "DPS"
            worker = "DPS"
        ts = row["작업일시"]
        hour   = ts.hour   if isinstance(ts, (pd.Timestamp, datetime)) else 0
        minute = ts.minute if isinstance(ts, (pd.Timestamp, datetime)) else 0
        second = ts.second if isinstance(ts, (pd.Timestamp, datetime)) else 0
        records.append({
            "A": zone + worker,
            "B": zone,
            "C": row.get("오더번호", ""),
            "D": row.get("ITEM ID", row.get("ITEM_ID", "")),
            "E": row.get("피킹수량", 0),
            "F": loc,
            "G": _to_int_str(row.get("PLT ID", row.get("PLT_ID", ""))),
            "H": _to_int_str(row.get("WAVE번호", "")),
            "I": wave_name,
            "J": worker,
            "K": ts,
            "L": region,
            "Y": hour,
            "Z": minute,
            "AA": second,
        })
    if not records:
        return pd.DataFrame(columns=list("ABCDEFGHIJKL") + ["Y", "Z", "AA"])

    out  = pd.DataFrame(records)
    last = out[out["B"].isin(last_zones)]
    rest = out[~out["B"].isin(last_zones)]

    # 정렬 기준 (docstring 참조):
    #   일반: J(작업자) > K(작업일시) > I(WAVE명) > G(PLT_ID) > F(LOCATION)
    #   DPS : J(작업자) > I(WAVE명)   > G(PLT_ID) > K(작업일시) > F(LOCATION)
    rest_sorted = rest.sort_values(["J", "K", "I", "G", "F"])
    # DPS(last): J="DPS"로 통일 후 I>G>K>F 정렬 (AK 이동시간이 I=WAVE명 경계로 발화)
    last_dps  = last[last["B"] == "DPS"].copy()
    last_dps["J"] = "DPS"
    last_rest = last[last["B"] != "DPS"]
    last_sorted = pd.concat([
        last_rest.sort_values(["J", "K", "I", "G", "F"]),
        last_dps.sort_values(["J", "I", "G", "K", "F"]),
    ])

    return pd.concat([rest_sorted, last_sorted]).reset_index(drop=True)


# ── 작업시간 계산 (가동률/표준시간 대체, 2026-09-28) ──────────────────
def _calc_wave_metrics(df: pd.DataFrame) -> dict:
    """(zone, worker)별 wave_time_hr / wms_time_hr 계산 — 순수 Python, Excel 불필요.

    df는 _build()의 A~L 출력(B=zone, G=PLT_ID, H=WAVE번호, J=작업자, K=작업일시)이면
    충분. DPS는 _build()가 이미 zone="DPS"/worker="DPS"로 통합해두므로 별도 처리 불필요
    (기존에 DPS 전용으로만 쓰던 zone-wide 타임스탬프 max-min 방식을 모든 구역/작업자로
    일반화한 것).

    - wave_time_hr: (G,H) wave 그룹별 max(K)-min(K) 합산 — 실제 피킹에 쓴 시간.
      wave 안에 pick이 1건(solo-pick)뿐이면 자체 span을 잴 수 없어, 같은 (zone,worker)의
      멀티픽 wave 평균 초/건을 그 1건에 적용해 추정한다(2026-09-28 수정 — 이전엔 0으로
      처리해 solo-pick 비중이 높은 작업자의 작업시간이 심각하게 과소집계됐음, 예:
      2026-09-27 M-N [야간]전종욱 박스 332개인데 wave_time_hr=0.0002h). 그 worker가 그
      zone에서 멀티픽 wave가 하나도 없으면 zone 전체 평균 초/건으로 폴백, 그마저 없으면
      (zone 전체가 이 날 전부 solo-pick) 기존처럼 0 처리 — 추정 근거가 전혀 없는 극히
      드문 경우라 억지로 값을 만들지 않고 알려진 한계로 남긴다.
    - wms_time_hr:  그 worker의 하루 전체 max(K)-min(K) — 첫 픽~마지막 픽 전체 span
      (wave 경계 무시, 휴게시간 등 포함).

    반환: {(zone, worker): {"wave_time_hr": float, "wms_time_hr": float}}
    """
    out: dict = {}
    if df is None or df.empty or "K" not in df.columns:
        return out

    zone_multi_span:  dict = {}   # zone → 멀티픽 wave span 합 (전체 작업자, 폴백용)
    zone_multi_picks: dict = {}   # zone → 멀티픽 wave pick 수 합
    records = []                  # (zone, worker, wms_hr, wave_hr, solo_count, multi_span, multi_picks)

    for (zone, worker), g in df.groupby(["B", "J"], dropna=False):
        ks = g["K"].dropna()
        if len(ks) == 0:
            continue
        wms_hr = (ks.max() - ks.min()).total_seconds() / 3600
        wave_hr = 0.0
        solo_count  = 0
        multi_span  = 0.0
        multi_picks = 0
        for _, wg in g.groupby(["G", "H"], dropna=False):
            wks = wg["K"].dropna()
            if len(wks) >= 2:
                span = (wks.max() - wks.min()).total_seconds() / 3600
                wave_hr     += span
                multi_span  += span
                multi_picks += len(wks)
            else:
                solo_count += 1
        zone_multi_span[zone]  = zone_multi_span.get(zone, 0.0) + multi_span
        zone_multi_picks[zone] = zone_multi_picks.get(zone, 0) + multi_picks
        records.append((zone, worker, wms_hr, wave_hr, solo_count, multi_span, multi_picks))

    for zone, worker, wms_hr, wave_hr, solo_count, multi_span, multi_picks in records:
        if solo_count > 0:
            if multi_picks > 0:
                rate = multi_span / multi_picks
            elif zone_multi_picks.get(zone, 0) > 0:
                rate = zone_multi_span[zone] / zone_multi_picks[zone]
            else:
                rate = 0.0
            wave_hr += rate * solo_count
        out[(zone, worker)] = {
            "wave_time_hr": round(wave_hr, 6),
            "wms_time_hr":  round(wms_hr, 6),
        }
    return out


# ── pywin32 유틸 ─────────────────────────────────────────────────────
_XL_ERRORS = frozenset({
    -2146826246, -2146826252, -2146826259, -2146826265,
    -2146826273, -2146826281, -2146826288,
})


def _safe(v) -> float:
    if not isinstance(v, (int, float)):
        return 0.0
    if isinstance(v, float) and v != v:
        return 0.0
    if isinstance(v, int) and v in _XL_ERRORS:
        return 0.0
    return float(v)


def _df_to_rows(df: pd.DataFrame) -> list:
    out = []
    for row in df[list("ABCDEFGHIJKL")].itertuples(index=False):
        clean = []
        for v in row:
            try:
                if pd.isna(v):
                    clean.append(None)
                    continue
            except (TypeError, ValueError):
                pass
            if isinstance(v, pd.Timestamp):
                clean.append(v.to_pydatetime().replace(tzinfo=None))
            else:
                clean.append(v)
        out.append(clean)
    return out


_WRITE_CHUNK = 5000  # COM Value= 대량 배열 한계(~9999행) 우회


def _write_sheet(ws, df: pd.DataFrame):
    """A~L열 데이터 초기화 후 청크 쓰기.

    win32com Range.Value= 단일 배열이 ~9999행에서 잘리는 현상을 방지하기 위해
    _WRITE_CHUNK 행 단위로 분할 작성.
    """
    last = ws.UsedRange.Row + ws.UsedRange.Rows.Count - 1
    if last >= 2:
        ws.Range(f"A2:L{last}").ClearContents()
    rows = _df_to_rows(df)
    for i in range(0, len(rows), _WRITE_CHUNK):
        chunk = rows[i:i + _WRITE_CHUNK]
        sr = 2 + i
        er = sr + len(chunk) - 1
        ws.Range(ws.Cells(sr, 1), ws.Cells(er, 12)).Value = \
            tuple(tuple(r) for r in chunk)
    print(f"    [{ws.Name}] {len(df)}행 작성")



def _write_sheet_full(ws, df: pd.DataFrame):
    """마스터 시트에 A~L(1~12)만 씀.

    가동률/표준시간 계산(AS/AT/AU 수식체인)을 더 이상 쓰지 않으므로, 그 전용
    입력값이었던 U~AA(랙/베이/레벨/시/분/초)는 기입 생략 — 박스수/피킹금액
    SUMIF는 A(zone+작업자 키)/E(수량)/가격 컬럼만 있으면 되고 이들과 무관함
    (2026-09-28 가동률 개념 제거 리팩터).
    """
    last = ws.UsedRange.Row + ws.UsedRange.Rows.Count - 1
    if last >= 2:
        ws.Range(ws.Cells(2, 1), ws.Cells(last, 12)).ClearContents()

    n = len(df)
    if n == 0:
        print(f"    [{ws.Name}] 데이터 없음")
        return

    def _clean(v):
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        if isinstance(v, pd.Timestamp):
            return v.to_pydatetime().replace(tzinfo=None)
        if isinstance(v, datetime):
            dt = v.replace(tzinfo=None)
            return dt
        return v

    def _prep_cols(cols):
        """datetime64 컬럼이 itertuples에서 오류를 일으키므로
        K열(작업일시)을 Python datetime으로 미리 변환한 뒤 object dtype으로 고정."""
        sub = df[cols].copy()
        if "K" in cols:
            sub["K"] = [
                v.to_pydatetime().replace(tzinfo=None) if isinstance(v, pd.Timestamp)
                else (None if v is None else v)
                for v in sub["K"]
            ]
            sub = sub.astype({"K": object})
        return [tuple(_clean(v) for v in row) for row in sub.itertuples(index=False)]

    # A~B (col 1~2): zone·zone+작업자 직접 씀 (마스터 수식을 클리어했으므로)
    ab_rows = [(_clean(row[0]), _clean(row[1]))
               for row in df[["A", "B"]].itertuples(index=False)]
    for i in range(0, n, _WRITE_CHUNK):
        chunk = ab_rows[i:i + _WRITE_CHUNK]
        sr, er = 2 + i, 1 + i + len(chunk)
        ws.Range(ws.Cells(sr, 1), ws.Cells(er, 2)).Value = tuple(chunk)

    # C~L (col 3~12)
    cl_rows = _prep_cols(list("CDEFGHIJKL"))
    for i in range(0, n, _WRITE_CHUNK):
        chunk = cl_rows[i:i + _WRITE_CHUNK]
        sr, er = 2 + i, 1 + i + len(chunk)
        ws.Range(ws.Cells(sr, 3), ws.Cells(er, 12)).Value = tuple(chunk)

    print(f"    [{ws.Name}] {n}행 작성 (A~L)")


def _write_picking_workers(wb, slots: dict, sources: dict):
    """
    피킹실적 C열(작업자명) + F열(zone+작업자명 = SUMIF 키) 동시 작성.

    마스터 피킹실적 SUMIF 수식이 피킹실적!$F열을 기준키로 사용함:
      =SUMIF(D_1!$A:$A, 피킹실적!$F행, D_1!$AU:$AU)/60

    F열 원본 수식이 일부 작업자에 대해 #N/A를 반환하면 SUMIF 전체가 오류 →
    합계 셀도 오류 → 종합실적 D열 = 0. 이를 방지하기 위해 F열에 직접 값 기입.

    D_1/I_1/DU_1 A열 키 형식: zone + 작업자명 (예: "M-N[야간]김시훈")
    DPS는 "DPS" + "DPS" = "DPSDPS" (마스터 A열 동일 형식).
    """
    ws = wb.Worksheets("피킹실적")
    try:
        ws.Unprotect()
    except Exception:
        pass
    for zone, (s, e) in slots.items():
        if zone == "DPS":
            workers = ["DPS"]
        else:
            df = sources.get(zone)
            workers = list(dict.fromkeys(df["J"].dropna().tolist())) if df is not None and not df.empty else []
        size = e - s + 1
        # C열: 작업자명 (사람이 읽을 수 있는 이름)
        c_data = tuple((workers[i],) if i < len(workers) else (None,) for i in range(size))
        ws.Range(ws.Cells(s, 3), ws.Cells(e, 3)).Value = c_data
        # F열: zone+작업자명 = 해당 시트 A열과 동일한 SUMIF 키
        f_data = tuple(
            (zone + workers[i],) if i < len(workers) else (None,)
            for i in range(size)
        )
        ws.Range(ws.Cells(s, 6), ws.Cells(e, 6)).Value = f_data
        print(f"      [{zone}] {len(workers)}명 (슬롯 {size}행)")


def _read_results(ws, zone_rows: dict) -> dict:
    # 종합실적 블록: 박스수=sr-1, 금액=sr-3 (표준/실적/wms 행은 더 이상 안 읽음 —
    # 가동률 계산 제거로 sr/ar 행 자체가 무의미해짐. 시간 지표는 _calc_wave_metrics로 대체)
    return {
        zone: {
            "pick_count":  _safe(ws.Cells(sr - 1, 4).Value),
            "pick_amount": _safe(ws.Cells(sr - 3, 4).Value),
        }
        for zone, (sr, ar) in zone_rows.items()
    }


def _read_picking_workers(wb, slots: dict, date_str: str) -> list:
    """피킹실적 시트에서 zone별 작업자 슬롯을 읽어 작업자별 박스수/금액 dict 리스트 반환.
       열: C(3)=작업자명, H(8)=박스수, I(9)=총피킹금액 (SUMIF 결과, 6/1 전구역 0% 검증완료).
       표준/실적/WMS 시간은 더 이상 이 시트에서 안 읽음 — _calc_wave_metrics가 raw
       타임스탬프에서 직접 계산 (호출측 process()에서 병합)."""
    ws = wb.Worksheets("피킹실적")
    out = []
    merged = {}   # (zone, name) → 합산 누적 (동일 작업자가 슬롯에 중복될 경우 대비)
    for zone, (s, e) in slots.items():
        owner  = ZONE_OWNER.get(zone, "")
        center = ZONE_CENTER.get(zone, "")
        c  = ws.Range(ws.Cells(s, 3),  ws.Cells(e, 3)).Value  or []
        h  = ws.Range(ws.Cells(s, 8),  ws.Cells(e, 8)).Value  or []
        ii = ws.Range(ws.Cells(s, 9),  ws.Cells(e, 9)).Value  or []
        for i in range(e - s + 1):
            name = c[i][0] if i < len(c) and c[i] else None
            if name is None or str(name).strip() == "":
                continue
            name = str(name).strip()
            box = _safe(h[i][0]);  amt = _safe(ii[i][0])
            if box == 0 and amt == 0:
                continue
            shift = "야간" if "[야간]" in name else "주간"
            key = (zone, name)
            if key in merged:
                agg = merged[key]
                agg["box"] += box; agg["amt"] += amt
            else:
                merged[key] = {
                    "center": center, "owner": owner, "shift": shift,
                    "box": box, "amt": amt,
                }
    for (zone, name), v in merged.items():
        out.append({
            "work_date": date_str, "center": v["center"], "owner": v["owner"],
            "zone": zone, "worker_name": name, "shift": v["shift"],
            "pick_amount": round(v["amt"], 0) if v["amt"] else None,
            "pick_box":    int(round(v["box"])) if v["box"] else None,
        })
    return out



# ── 공장도가 로드 / 피킹금액 기입 ────────────────────────────────────
# owner별 시트 매핑:
#   퍼시스/시디즈(F_1) → 퍼,시_단품정보
#   일룸/데스커(I_1/D_1) → 일-단품정보
#   3PL/바로스(DU_1) → 바-단품정보
_PRICE_SHEET_MAP = {
    "F_1":  "퍼,시_단품정보",
    "I_1":  "일-단품정보",
    "D_1":  "일-단품정보",
    "DU_1": "바-단품정보",
}
_price_cache: dict[str, dict] = {}

def _load_price_map(owner: str = "ALL") -> dict:
    """
    기준정보_공장도가.xlsx에서 owner별 시트를 읽어 제품코드 → 공장도가 딕셔너리 반환.
    키: D열 합성코드 (단품코드-컬러), 값: 공장도가(숫자)
    """
    global _price_cache
    if owner in _price_cache:
        return _price_cache[owner]
    if not PRICE_MASTER.exists():
        print(f"  [공장도가] 파일 없음: {PRICE_MASTER}")
        _price_cache[owner] = {}
        return {}

    # 92MB xlsx를 pandas로 owner마다 재읽기하면 매우 느림.
    #   → openpyxl read_only 스트리밍으로 파일 1회만 열어 3개 시트를 한 번에 읽고,
    #     결과를 디스크(pickle)에 캐싱. 원본 mtime이 같으면 다음 실행은 즉시 로드.
    import pickle
    src_mtime  = PRICE_MASTER.stat().st_mtime
    cache_pkl  = BASE_DIR / "data/temp/price_cache.pkl"
    sheet_maps = None
    if cache_pkl.exists():
        try:
            with open(cache_pkl, "rb") as _f:
                _blob = pickle.load(_f)
            if _blob.get("mtime") == src_mtime:
                sheet_maps = _blob.get("sheets")
                print(f"  [공장도가] 디스크 캐시 사용 ({len(sheet_maps)}시트)")
        except Exception:
            sheet_maps = None

    if sheet_maps is None:
        import openpyxl
        print(f"  [공장도가] 원본 읽는 중 (92MB, read_only 스트리밍, 최초 1회)...")
        wb = openpyxl.load_workbook(PRICE_MASTER, read_only=True, data_only=True)
        sheet_maps = {}
        for sname in set(_PRICE_SHEET_MAP.values()):
            if sname not in wb.sheetnames:
                continue
            ws = wb[sname]
            it = ws.iter_rows(values_only=True)
            header = next(it, None)
            if not header:
                continue
            price_idx = None
            for i, h in enumerate(header):
                if h is not None and str(h).strip() == "공장도가":
                    price_idx = i
                    break
            if price_idx is None:
                continue
            m: dict = {}
            for row in it:
                if row is None or len(row) <= max(3, price_idx):
                    continue
                code_v = row[3]  # D열
                code = str(code_v).strip() if code_v is not None else ""
                if not code or code in ("nan", "NaN", "None"):
                    continue
                pv = row[price_idx]
                try:
                    price = float(str(pv).replace(",", "").strip()) if pv is not None else 0.0
                except (ValueError, TypeError):
                    price = 0.0
                m[code] = price
            sheet_maps[sname] = m
        wb.close()
        try:
            cache_pkl.parent.mkdir(parents=True, exist_ok=True)
            with open(cache_pkl, "wb") as _f:
                pickle.dump({"mtime": src_mtime, "sheets": sheet_maps}, _f)
        except Exception:
            pass
        print(f"  [공장도가] {len(sheet_maps)}시트 로드 완료 "
              f"({', '.join(f'{k}:{len(v)}' for k, v in sheet_maps.items())})")

    # owner별 캐시 채우기
    for o, sn in _PRICE_SHEET_MAP.items():
        _price_cache[o] = sheet_maps.get(sn, {})
    if owner not in _price_cache:  # ALL 등: 전체 병합
        merged: dict = {}
        for mm in sheet_maps.values():
            merged.update(mm)
        _price_cache[owner] = merged
    return _price_cache[owner]


def _write_price_cols(ws, n_rows: int, price_map: dict) -> dict:
    """
    col59(BG)=공장도가, col58(BF)=피킹금액(수량×공장도가) 직접 기입.
    VLOOKUP 수식 대신 Python이 값을 써서 파일 간 참조 오류 방지.

    반환: {품목코드: {"qty": 합계수량, "rows": 행수}} — price_map에 없어서
    0원 처리된 품목 (일일 리포트 "특이사항" 집계용, 2026-07-08)
    """
    if n_rows == 0 or not price_map:
        return {}
    # 배치로 읽기 — win32com은 1행짜리 Range.Value를 (다른 행 수와 달리) 중첩
    # 튜플이 아닌 스칼라로 반환하므로, 아래 d_rng[i][0] 인덱싱과 형태를 맞춘다.
    d_rng = ws.Range(ws.Cells(2, 4), ws.Cells(n_rows + 1, 4)).Value  # D열(ItemId)
    e_rng = ws.Range(ws.Cells(2, 5), ws.Cells(n_rows + 1, 5)).Value  # E열(수량)
    if n_rows == 1:
        d_rng = ((d_rng,),)
        e_rng = ((e_rng,),)
    bg_vals = []
    bf_vals = []
    missing: dict = {}
    for i in range(n_rows):
        item_id = d_rng[i][0] if d_rng else None
        qty = e_rng[i][0] if e_rng else 0
        code = str(item_id).strip() if item_id else ""
        qty_n = float(qty) if qty else 0.0
        if code not in price_map:
            m = missing.setdefault(code, {"qty": 0.0, "rows": 0})
            m["qty"]  += qty_n
            m["rows"] += 1
        price = price_map.get(code, 0.0)
        bg_vals.append([price])
        bf_vals.append([qty_n * price])
    ws.Range(ws.Cells(2, 59), ws.Cells(n_rows + 1, 59)).Value = bg_vals
    ws.Range(ws.Cells(2, 58), ws.Cells(n_rows + 1, 58)).Value = bf_vals
    total = sum(r[0] for r in bf_vals)
    print(f"    [{ws.Name}] 피킹금액 합계: {total:,.0f}원"
          + (f"  [경고] 단가 없는 품목 {len(missing)}종" if missing else ""))
    return missing


# ── 마스터 시트 직접 로드 ────────────────────────────────────────────
def _load_master_sheets(target: date) -> tuple | None:
    """
    기준정보_마스터.xlsx / 기준정보2_마스터.xlsx의 F_1·I_1·D_1·DU_1 시트에서
    A-L 데이터를 직접 로드한다.

    타겟 날짜 확인: F_1 K열에 target 날짜 데이터가 있어야 유효.
    없으면 None 반환 → 호출자가 raw 기반으로 폴백.

    마스터 데이터를 사용하면 raw → 변환 과정의 오차(zone 분류 오류, 정렬 불일치,
    수동 추가 행 누락 등)를 모두 제거할 수 있다.
    """
    def _load(path, sheet):
        df = pd.read_excel(path, sheet_name=sheet, header=0,
                           usecols=range(12), engine="openpyxl")
        df.columns = list("ABCDEFGHIJKL")
        df = df.dropna(subset=["J"]).reset_index(drop=True)
        df["K"] = pd.to_datetime(df["K"], errors="coerce")
        return df

    try:
        f1  = _load(MASTER1, "F_1")
        i1  = _load(MASTER1, "I_1")
        d1  = _load(MASTER2, "D_1")
        du1 = _load(MASTER2, "DU_1")
    except Exception as e:
        print(f"  [마스터 로드 실패] {e}")
        return None

    if len(f1) == 0:
        return None

    # 타겟 날짜 검증: F_1의 K열에 target 날짜가 있는지 확인
    dates_in_f1 = set(f1["K"].dropna().dt.date.unique())
    if target not in dates_in_f1:
        print(f"  [마스터] F_1에 {target} 데이터 없음 → raw 모드로 폴백")
        return None

    print(f"  [마스터 직접 모드] F_1={len(f1)}행 I_1={len(i1)}행 "
          f"D_1={len(d1)}행 DU_1={len(du1)}행")
    return f1, i1, d1, du1


# ── 메인 처리 ────────────────────────────────────────────────────────
def process(target: date, from_master: bool = False) -> dict:
    date_str = str(target)
    print(f"\n{'='*60}\n처리 날짜: {date_str}\n{'='*60}")

    # ── 마스터 직접 모드: 마스터 시트 A-L 데이터 로드 ───────────────────
    if from_master:
        master_data = _load_master_sheets(target)
        if master_data:
            sd_f1, sd_i1, sd_d1, sd_du1 = master_data
        else:
            print("  [마스터 모드 실패] raw 기반으로 폴백")
            from_master = False

    # ── raw 기반 모드: raw → A~L 정제 (순수 Python, Excel 불필요) ────────
    if not from_master:
        lm1 = _load_loc_map(LOC_MASTER1)
        lm2 = _load_loc_map(LOC_MASTER2)
        lm3 = _load_loc_map(LOC_MASTER3)

        def _load_filtered(owner, filter_fn):
            p = find_raw(target, owner)
            if not p:
                print(f"  [{owner}] 파일 없음")
                return pd.DataFrame()
            print(f"  [{owner}] {p.name}")
            df = _load_raw(p)
            out = filter_fn(df, target, p)
            print(f"    필터 후 {len(out)}행")
            return out

        # ── 1. raw data 파일 필터링
        print("\n  [1] raw data 필터링...")
        raw_f1  = _load_filtered("퍼시스", _filter_f1)
        raw_i1  = _load_filtered("일룸",   _filter_i1)
        raw_d1  = _load_filtered("데스커", _filter_d1)
        raw_du1 = _load_filtered("3PL",    _filter_du1)

        # 퍼시스 특수: G구역 작업자 '장재완' From 로케이션 → K-115-00
        if not raw_f1.empty:
            _mask_jw = (
                raw_f1["작업자"].astype(str).str.contains("장재완", na=False) &
                raw_f1["LOCATION"].astype(str).str.upper().str.startswith("G-")
            )
            n_jw = _mask_jw.sum()
            if n_jw > 0:
                raw_f1.loc[_mask_jw, "LOCATION"] = "K-115-00"
                print(f"    [퍼시스] 장재완 G구역 {n_jw}행 → K-115-00 변경")

        # ── 2. 시트 레코드로 정제 (zone 분류 + 정렬) — 이전엔 "가동률-로데이터"
        # Excel 템플릿(KGA)에 원본을 넣고 CalculateFull()로 rack/bay/level까지
        # 계산해서 읽어왔지만, 그건 표준시간(AS/AT/AU) 수식 입력값을 만들기
        # 위해서였을 뿐 — 가동률 개념을 없앤 지금은 필요 없다. _build()가 이미
        # 순수 Python으로 동일한 A~L(zone/작업자/PLT/WAVE/작업일시 등) 구조를
        # 만들어내므로 그걸 직접 쓴다 (2026-09-28).
        print("\n  [2] 데이터 정제...")
        sd_f1 = _build(
            raw_f1, lambda loc: _zone1(loc, lm1),
            last_zones=[],  # L/S를 마지막에 고정하지 않고 K(작업일시) 순 혼합 배치
        )
        sd_i1 = _build(
            raw_i1, lambda loc: _zone1(loc, lm1),
            last_zones=["DPS"],
            loc_corrections=_I1_LOC_CORRECTIONS,
        )
        sd_d1 = _build(
            raw_d1, lambda loc: _zone2(loc, lm2),
            fixed_region="가설창고",
            last_zones=["S"],
        )
        sd_du1 = _build(
            raw_du1, lambda loc: _zone3(loc, lm3),
            fixed_region="가설창고",
            last_zones=[],
        )
        print(f"    F_1={len(sd_f1)}행  I_1={len(sd_i1)}행  "
              f"D_1={len(sd_d1)}행  DU_1={len(sd_du1)}행")

    # zone별 행 수 요약
    print("\n  [zone별 행 수]")
    for name, sd in [("F_1(퍼시스)", sd_f1), ("I_1(일룸)", sd_i1),
                     ("D_1(데스커)", sd_d1), ("DU_1(3PL)", sd_du1)]:
        if sd.empty:
            print(f"    {name}: 데이터 없음")
        else:
            counts = sd["B"].value_counts().sort_index()
            print(f"    {name}: 총 {len(sd)}행")
            for z, c in counts.items():
                print(f"      {z}: {c}")

    # 작업시간(wave_time_hr/wms_time_hr) 계산 — (zone, worker) 키로 순수 Python 산출.
    # 예전엔 DPS만 zone 전체를 하나로 묶어 타임스탬프 max-min을 구했는데(N열 수식
    # 불신), 이제 모든 구역/작업자에 대해 같은 방식(_calc_wave_metrics)을 씀.
    print("\n  [3] 작업시간 계산 (wave 기반)...")
    wave_metrics: dict = {}
    for sd in (sd_f1, sd_i1, sd_d1, sd_du1):
        wave_metrics.update(_calc_wave_metrics(sd))
    _total_wave = sum(v["wave_time_hr"] for v in wave_metrics.values())
    _total_wms  = sum(v["wms_time_hr"]  for v in wave_metrics.values())
    print(f"    {len(wave_metrics)}명(zone·worker) — 합계 wave={_total_wave:.1f}h, wms={_total_wms:.1f}h")

    # 잔여 Excel 프로세스 종료 (마스터 파일 잠금 해제)
    r = subprocess.run(["taskkill", "/f", "/im", "EXCEL.EXE"], capture_output=True, check=False)
    if r.returncode == 0:
        time.sleep(3)

    # 마스터 복사본 생성 (Excel 잠금 상태에서도 바이트 복사로 우회)
    TEMP1.parent.mkdir(parents=True, exist_ok=True)
    for src, dst in [(MASTER1, TEMP1), (MASTER2, TEMP2)]:
        try:
            shutil.copy2(src, dst)
        except PermissionError:
            with open(src, "rb") as fin, open(dst, "wb") as fout:
                fout.write(fin.read())

    import win32com.client as win32
    excel = win32.Dispatch("Excel.Application")
    excel.Visible = False
    excel.DisplayAlerts = False
    # 성능: 자동 재계산/화면갱신/이벤트 OFF — 데이터 입력이 다 끝난 뒤
    #   [5] CalculateFull()에서 한 번만 계산.
    excel.ScreenUpdating = False
    excel.EnableEvents = False

    try:
        print("\n  [1] Excel 열기...")
        wb1 = excel.Workbooks.Open(str(TEMP1.resolve()))
        wb2 = excel.Workbooks.Open(str(TEMP2.resolve()))
        # 자동 재계산 OFF — 워크북이 하나 이상 열린 뒤에만 설정 가능
        excel.Calculation = -4135  # xlCalculationManual
        print("  [완료]")

        # ── 피킹실적 C열 작업자 업데이트
        print("\n  [2] 피킹실적 C열 업데이트...")
        _write_picking_workers(wb1, PICKING_SLOTS_1, {
            "H-I": sd_i1[sd_i1["B"] == "H-I"],
            "C-D": sd_i1[sd_i1["B"] == "C-D"],
            "A-P": sd_i1[sd_i1["B"] == "A-P"],
            "E-F": sd_f1[sd_f1["B"] == "E-F"],
            "J-K": sd_f1[sd_f1["B"] == "J-K"],
            "L":   sd_f1[sd_f1["B"] == "L"],
            "B":   sd_f1[sd_f1["B"] == "B"],
            "L/S": sd_f1[sd_f1["B"] == "L/S"],
        })
        _write_picking_workers(wb2, PICKING_SLOTS_2, {
            "M-N": sd_d1[sd_d1["B"] == "M-N"],
            "S":   sd_d1[sd_d1["B"] == "S"],
            "W":   sd_du1[sd_du1["B"] == "W"],
            "R":   sd_du1[sd_du1["B"] == "R"],
        })
        print("  [완료]")

        # ── 시트 데이터 쓰기 (A~L)
        print("\n  [3] 시트 데이터 쓰기...")
        _write_sheet_full(wb1.Worksheets("F_1"), sd_f1)
        _write_sheet_full(wb1.Worksheets("I_1"), sd_i1)
        _write_sheet_full(wb2.Worksheets("D_1"), sd_d1)
        _write_sheet_full(wb2.Worksheets("DU_1"), sd_du1)
        print("  [완료]")

        # ── 피킹금액(BF/BG열) 기입 (owner별 시트 분리: 퍼시스→퍼,시, 일룸/데스커→일, 3PL→바)
        print("\n  [4] 피킹금액(BF/BG열) 기입...")
        _price_gaps = {
            "퍼시스": _write_price_cols(wb1.Worksheets("F_1"),  len(sd_f1),  _load_price_map("F_1")),
            "일룸":   _write_price_cols(wb1.Worksheets("I_1"),  len(sd_i1),  _load_price_map("I_1")),
            "데스커": _write_price_cols(wb2.Worksheets("D_1"),  len(sd_d1),  _load_price_map("D_1")),
            "3PL":    _write_price_cols(wb2.Worksheets("DU_1"), len(sd_du1), _load_price_map("DU_1")),
        }
        _price_gaps = {k: v for k, v in _price_gaps.items() if v}
        import json as _json_pg
        gap_path = BASE_DIR / f"data/temp/price_gaps_picking_{target}.json"
        if _price_gaps:
            gap_path.write_text(_json_pg.dumps(_price_gaps, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"    [단가 갭 저장] {gap_path.name}")
        elif gap_path.exists():
            gap_path.unlink()  # 이전 실행의 stale 갭 파일 제거
        print("  [완료]")

        # ── I_1 A열 값 고정 (수식→값) — SUMIF 매칭 안정성용, 가동률 계산과 무관하게 유지
        ws_i1 = wb1.Worksheets("I_1")
        n = len(sd_i1)
        if n > 0:
            rng = ws_i1.Range(f"A2:A{n+1}")
            rng.Value = rng.Value

        # ── 수식 재계산 (박스수/피킹금액 SUMIF만 해소하면 되므로 예전보다 훨씬 가벼움 —
        # AS/AT/AU 표준시간 수식체인 지원 코드를 걷어내서 fill-down/IFERROR 단계 자체가
        # 없어짐, 2026-09-28)
        print("\n  [5] CalculateFull() 실행 중...")
        excel.CalculateFull()
        print("  [완료]")

        # ── [6] 결과 읽기 (박스수/금액 — 시간 지표는 위 wave_metrics 사용)
        print("\n  [6] 결과 읽기...")
        r1 = _read_results(wb1.Worksheets("종합실적"), ZONE_ROWS_1)
        r2 = _read_results(wb2.Worksheets("종합실적"), ZONE_ROWS_2)

        # ── 피킹실적 작업자별 + 구역별 추출 → JSON 저장 (DB 적재용, 우리 계산값)
        try:
            import json as _json
            workers = (_read_picking_workers(wb1, PICKING_SLOTS_1, str(target))
                       + _read_picking_workers(wb2, PICKING_SLOTS_2, str(target)))
            # wave_metrics(wave_time_hr/wms_time_hr)를 (zone, worker) 키로 병합
            for _w in workers:
                _m = wave_metrics.get((_w.get("zone"), _w.get("worker_name")), {})
                _w["wave_time_hr"] = _m.get("wave_time_hr")
                _w["wms_time_hr"]  = _m.get("wms_time_hr")
            wpath = BASE_DIR / f"data/temp/workers_{target}.json"
            with open(wpath, "w", encoding="utf-8") as _f:
                _json.dump(workers, _f, ensure_ascii=False, indent=2)
            print(f"\n  [피킹실적 작업자별] {len(workers)}명 추출 → {wpath.name}")

            # ── raw snapshot: 작업자별 원천값 그대로 보관 (검증·재계산용) ──
            # workers_DATE.json과 동일 구조지만 "이 파일이 Excel 직출력 원본"임을 명시
            # 향후 로직 변경 시 raw 기반 재산출 가능하도록 별도 보관
            snap_path = BASE_DIR / f"data/temp/raw_workers_{target}.json"
            with open(snap_path, "w", encoding="utf-8") as _f:
                _json.dump(workers, _f, ensure_ascii=False, indent=2)
            _no_wave = sum(1 for w in workers if not w.get("wave_time_hr"))
            print(f"  [raw snapshot] {snap_path.name}  (wave_time_hr 없음={_no_wave}명)")

            # 구역별 (종합실적 박스수/금액 = 우리 계산값, 작업시간 = wave_metrics 구역합산)
            zone_wave: dict = {}
            for (zone, _worker), m in wave_metrics.items():
                zw = zone_wave.setdefault(zone, {"wave_time_hr": 0.0, "wms_time_hr": 0.0})
                zw["wave_time_hr"] += m["wave_time_hr"]
                zw["wms_time_hr"]  += m["wms_time_hr"]

            zone_rows = []
            for zone, v in {**r1, **r2}.items():
                box = _safe(v.get("pick_count"));   amt = _safe(v.get("pick_amount"))
                zw = zone_wave.get(zone, {})
                wave_hr = zw.get("wave_time_hr", 0.0)
                wms_hr  = zw.get("wms_time_hr", 0.0)
                if box == 0 and amt == 0 and wave_hr == 0 and wms_hr == 0:
                    continue
                zone_rows.append({
                    "work_date": str(target), "center": ZONE_CENTER.get(zone, ""),
                    "owner": ZONE_OWNER.get(zone, ""), "zone": zone,
                    "pick_amount": round(amt, 0) if amt else None,
                    "pick_box":    int(round(box)) if box else None,
                    "wave_time_hr": round(wave_hr, 4) if wave_hr > 0 else None,
                    "wms_time_hr":  round(wms_hr, 4) if wms_hr > 0 else None,
                })
            zpath = BASE_DIR / f"data/temp/zones_{target}.json"
            with open(zpath, "w", encoding="utf-8") as _f:
                _json.dump(zone_rows, _f, ensure_ascii=False, indent=2)
            print(f"  [종합실적 구역별] {len(zone_rows)}구역 추출 → {zpath.name}")
        except Exception:
            import traceback; traceback.print_exc()

        wb1.Close(SaveChanges=False)
        wb2.Close(SaveChanges=False)

    finally:
        # 계산/화면/이벤트 모드 원복 (Dispatch가 기존 인스턴스에 붙은 경우 대비)
        try:
            excel.Calculation = -4105  # xlCalculationAutomatic
            excel.ScreenUpdating = True
            excel.EnableEvents = True
        except Exception:
            pass
        excel.Quit()

    return {**r1, **r2}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="처리 날짜 (YYYY-MM-DD)")
    parser.add_argument("--from-master", action="store_true",
                        help="기준정보_마스터.xlsx A-L 데이터를 직접 사용 (raw 변환 생략)")
    args   = parser.parse_args()
    target = datetime.strptime(args.date, "%Y-%m-%d").date()

    results = process(target, from_master=args.from_master)

    print(f"\n  [최종 결과]")
    for z, v in results.items():
        box = v.get("pick_count") or 0
        amt = v.get("pick_amount") or 0
        print(f"    {z:<6}: 박스={box:.0f}  금액={amt:.0f}")

    # 결과 JSON 저장 (박스/금액 — 시간 지표는 zones_{date}.json 쪽에 있음)
    import json
    out_path = BASE_DIR / f"data/temp/result_{args.date}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({z: {"pick_box": v.get("pick_count"), "pick_amount": v.get("pick_amount")}
                   for z, v in results.items()}, f, ensure_ascii=False, indent=2)
    print(f"  [결과 저장] {out_path}")


if __name__ == "__main__":
    main()
