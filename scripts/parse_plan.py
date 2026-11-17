"""Parse data/Program_HM_Sub145_Mei2027.xlsx -> seed/plan.json + seed/parse_report.md

Prinsip: setiap segmen menyimpan KODE INTENSITAS (bukan pace absolut).
Pace yang cocok persis dengan pace profile -> kode langsung.
Pace yang TIDAK cocok persis -> TIDAK ditebak diam-diam: dicatat di laporan
(issues) beserta usulan kode + penyesuaian (pace_adj_s), segmen diberi review=true.

Jalankan:  python scripts/parse_plan.py
"""
from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "Program_HM_Sub145_Mei2027.xlsx"
OUT = ROOT / "seed" / "plan.json"
REPORT = ROOT / "seed" / "parse_report.md"

# ---------------------------------------------------------------- pace profile
# detik/km (min = paling cepat, max = paling lambat)
PACE_PROFILE = {
    "WU": (360, 390), "E": (350, 390), "REC": (365, 400), "L": (345, 375),
    "M": (315, 320), "H": (295, 300), "T": (288, 295), "N": (265, 280),
    "JOG": (420, 480), "TJOG": (390, 420), "S": (230, 250),
}
PACE_PROFILE_BASE = {"T": (298, 305), "N": (275, 285)}  # fase Base W03–W08
BASE_WEEKS = range(3, 9)

# zona default per kode (dari sheet ⏱️ Pace & Zone Guide)
DEFAULT_ZONE = {
    "WU": "Z1-2", "E": "Z2", "REC": "Z1", "L": "Z2", "M": "Z3", "H": "Z4",
    "T": "Z4", "N": "Z5", "JOG": "Z1", "TJOG": "Z1", "S": None, "HILL": None, "TEST": "Z4-5",
}

# R12 tangga toleransi Z4 (menit) untuk tempo Kamis
def z4_ladder(week: int):
    if 4 <= week <= 6:
        return 20
    if 7 <= week <= 11:
        return 30
    if 12 <= week <= 13:
        return 40
    return None  # W15–W24 = blok HM pace 9–12 km (dinyatakan dalam km, bukan menit)

RECOVERY_WEEKS = {6, 10, 14, 18, 22}
DAY_COLS = {  # kolom teks, kolom km, offset hari dari Senin
    "tue": ("E", "F", 1), "wed": ("G", "H", 2), "thu": ("I", "J", 3),
    "sat": ("K", "L", 5), "sun": ("M", "N", 6),
}

issues: list[dict] = []


def issue(week, day, kind, text, proposal=None):
    issues.append({"week": week, "day": day, "kind": kind, "text": text, "proposal": proposal})


def pace_s(txt: str) -> int:
    m, s = txt.split(":")
    return int(m) * 60 + int(s)


def fmt(sec: int) -> str:
    return f"{sec // 60}:{sec % 60:02d}"


def profile_for(week: int, code: str, variant: str | None = None):
    if code in PACE_PROFILE_BASE and (variant == "base" or (variant is None and week in BASE_WEEKS)):
        return PACE_PROFILE_BASE[code]
    return PACE_PROFILE.get(code)


def match_pace(week, day, pmin, pmax, zone, hint=None):
    """Return dict(intensity, pace_variant?, pace_adj_s?, review?)."""
    rng = (pmin, pmax)
    # 1) cocok persis dengan profil (fase-aware)
    exact = [c for c in PACE_PROFILE if profile_for(week, c) == rng]
    if hint and hint in exact:
        return {"intensity": hint}
    if len(exact) == 1:
        return {"intensity": exact[0]}
    if len(exact) > 1:
        # E vs WU dll: pakai hint
        return {"intensity": hint or exact[0]}
    # 2) cocok dengan varian base di minggu non-base
    for c, r in PACE_PROFILE_BASE.items():
        if r == rng:
            res = {"intensity": c, "pace_variant": "base", "review": True}
            issue(week, day, "pace_variant",
                  f"@{fmt(pmin)}–{fmt(pmax)} = pace {c} fase Base, tapi W{week:02d} bukan fase Base",
                  f"intensity={c}, pace_variant=base")
            return res
    # 3) tidak cocok -> usulan kode terdekat + penyesuaian
    cands = list(PACE_PROFILE)
    if hint not in PACE_PROFILE:
        hint = None
    if hint:
        cands = [hint] + [c for c in cands if c != hint]
    best = min(cands, key=lambda c: (abs(profile_for(week, c)[0] - pmin) + abs(profile_for(week, c)[1] - pmax)) - (0.5 if c == hint else 0))
    if hint:
        best = hint
    bmin, bmax = profile_for(week, best)
    adj = [pmin - bmin, pmax - bmax]
    issue(week, day, "pace_unmatched",
          f"@{fmt(pmin)}–{fmt(pmax)} [{zone or '-'}] tidak ada di pace profile",
          f"intensity={best} ({fmt(bmin)}–{fmt(bmax)}) + pace_adj_s={adj}")
    return {"intensity": best, "pace_adj_s": adj, "review": True}


PACE_RE = re.compile(r"@\s*(\d:\d\d)(?:\s*[–-]\s*(\d:\d\d))?")
ZONE_RE = re.compile(r"\[(Z\d(?:[–-]\d)?)\]")
NUM = r"(\d+(?:,\d+)?)"


def num(x: str) -> float:
    return float(x.replace(",", "."))


def norm_zone(z):
    return z.replace("–", "-") if z else None


def preprocess(text: str) -> tuple[list[str], list[str]]:
    """Gabungkan baris lanjutan; pisahkan catatan '( ... )'. Return (clauses, notes)."""
    text = text.replace("＠", "@")
    raw = [l.strip() for l in text.split("\n") if l.strip()]
    clauses, notes = [], []
    for line in raw:
        if line.startswith("(") and line.endswith(")") and "@" not in line:
            notes.append(line.strip("()"))
            continue
        cont = clauses and (
            clauses[-1].endswith("/")
            or line.startswith("→")
            or line.startswith("@")
            or line.startswith("treadmill")
            or line.startswith("LTHR")
        )
        if cont:
            sep = "" if clauses[-1].endswith("/") else " "
            clauses[-1] = clauses[-1] + sep + line
        else:
            clauses.append(line)
    # pecah "A → B → C" dan "A + 8 km @..." jadi sub-klausa
    out = []
    for c in clauses:
        if "TES 30 MENIT" in c:
            out.append(c); continue
        parts = re.split(r"\s+→\s+|\s+\+\s+(?=\d+(?:,\d+)?\s*km\b)", c)
        out.extend(p.strip() for p in parts if p.strip())
    return out, notes


def strip_note(rest: str):
    m = re.search(r"\(([^)]*)\)", rest)
    return (m.group(1) if m else None)


def seg_from_pace(week, day, clause, kind, hint, **extra):
    pm = PACE_RE.search(clause)
    zm = ZONE_RE.search(clause)
    zone = norm_zone(zm.group(1)) if zm else None
    seg = {"kind": kind, **extra}
    if pm:
        pmin = pace_s(pm.group(1))
        pmax = pace_s(pm.group(2)) if pm.group(2) else pmin
        if not pm.group(2):
            issue(week, day, "pace_single", f"pace tunggal @{pm.group(1)} di '{clause}'",
                  f"diperlakukan sebagai rentang {pm.group(1)}–{pm.group(1)}")
        seg.update(match_pace(week, day, pmin, pmax, zone, hint))
        seg["src_pace"] = f"{fmt(pmin)}–{fmt(pmax)}"
    else:
        seg["intensity"] = hint
    code = seg.get("intensity")
    seg["hr_zone"] = zone or DEFAULT_ZONE.get(code)
    if not zone and code not in ("S", "HILL", "JOG", "TJOG") and hint is not None:
        issue(week, day, "zone_missing", f"tidak ada tag zona di '{clause}'",
              f"hr_zone={seg['hr_zone']} (default kode {code})")
    note = strip_note(PACE_RE.split(clause)[-1]) if pm else None
    if note:
        seg["note"] = note
    return seg


def parse_clause(week, day, clause):
    c = clause
    low = c.lower()
    # --- warmup / cooldown
    m = re.match(rf"^(WU|CD)\s+{NUM}\s*km\b", c)
    if m:
        kind = "warmup" if m.group(1) == "WU" else "cooldown"
        return seg_from_pace(week, day, c, kind, "WU", distance_m=int(num(m.group(2)) * 1000))
    # --- recovery jog antar rep
    m = re.match(rf"^rec\s+{NUM}\s*m\s+jog", c)
    if m:
        return seg_from_pace(week, day, c, "recovery", "JOG", distance_m=int(num(m.group(1))))
    # --- strides
    m = re.match(rf"^\+?\s*(\d+)×(\d+)\s*m\s+strides", c)
    if m:
        return seg_from_pace(week, day, c, "strides", "S", reps=int(m.group(1)), distance_m=int(m.group(2)))
    # --- hill sprint
    m = re.match(r"^\+?\s*(\d+)×(\d+)\s*dtk\s+hill sprint", c)
    if m:
        return {"kind": "hill", "intensity": "HILL", "reps": int(m.group(1)), "duration_s": int(m.group(2)),
                "hr_zone": None, "effort": "±90%", "recovery": "jalan turun",
                "note": "flyover/ramp/treadmill 6–8%"}
    # --- tes 30 menit
    if "TES 30 MENIT" in c:
        seg = _test_seg(c, duration_s=1800, test_type="30min",
                        target_note="target ≥ 6,2 km; LTHR = avg HR 20′ terakhir")
        seg["distance_m"] = None; seg["fill_remaining"] = True; seg["distance_is_estimate"] = True
        return seg
    # --- 10K TT
    if "TIME TRIAL" in c:
        return _test_seg(c, distance_m=10000, test_type="10k_tt", target_note="±47:00")
    # --- reps kerja: "4×1 km", "Tempo 3×1,6 km", "HM pace 2×5 km", "Fartlek 6×250 m"
    m = re.match(rf"^(?:(Tempo|HM pace|Fartlek)\s+)?(\d+)×{NUM}\s*(km|m)\b", c)
    if m:
        label = (m.group(1) or "").lower()
        dist = num(m.group(3)) * (1000 if m.group(4) == "km" else 1)
        hint = {"tempo": "T", "hm pace": "H", "fartlek": None}.get(label, "N")
        seg = seg_from_pace(week, day, c, "work", hint, reps=int(m.group(2)), distance_m=int(dist))
        if label:
            seg["label"] = m.group(1)
        if label == "fartlek":  # D3: effort-based, tanpa zona
            seg["hr_zone"] = None
        return seg
    # --- kontinu: "Tempo 5 km kontinu", "HM pace 8 km kontinu"
    m = re.match(rf"^(Tempo|HM pace)\s+{NUM}\s*km\s+kontinu", c)
    if m:
        hint = "T" if m.group(1) == "Tempo" else "H"
        seg = seg_from_pace(week, day, c, "work", hint, reps=1, distance_m=int(num(m.group(2)) * 1000))
        seg["label"] = m.group(1) + " kontinu"
        return seg
    # --- race day: "km 1–3 @..."
    m = re.match(r"^km\s+(\d+)[–-](\d+)\s*@", c)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        b_eff = 21.1 if b == 21 else b
        return seg_from_pace(week, day, c, "work", "H", distance_m=int(round((b_eff - a + 1) * 1000)),
                             label=f"race km {a}–{b}")
    # --- progresif / blok berjarak: "Progresif: 8 km @..", "17 km @..", "+ 3 km terakhir @.."
    m = re.match(rf"^(?:Progresif:\s*|🎯 SIMULASI RACE:\s*|\+\s*)?{NUM}\s*km\b", c)
    if m:
        dist = int(num(m.group(1)) * 1000)
        pm = PACE_RE.search(c)
        hint = None
        if pm:
            p = pace_s(pm.group(1))
            hint = "L" if p >= 330 else None
        kind = "steady"
        if "jog" in low:
            kind = "recovery"
        seg = seg_from_pace(week, day, c, kind, _hint_for_block(week, c), distance_m=dist)
        if day != "sat" and seg.get("intensity") in ("H", "M", "T"):
            seg["kind"] = "work"; seg["reps"] = 1
        if "terakhir" in low:
            seg["position"] = "last"
        if c.startswith("Progresif"):
            seg["label"] = "Progresif"
        if c.startswith("🎯"):
            seg["label"] = "Simulasi race"
        return seg
    # --- easy / long / recovery / shake-out tanpa jarak -> sisa km
    for key, kind, hint in (("Easy", "steady", "E"), ("Long run", "steady", "L"),
                            ("Recovery", "steady", "REC"), ("Shake-out", "steady", "WU")):
        if c.startswith(key):
            seg = seg_from_pace(week, day, c, kind, hint, distance_m=None)
            seg["fill_remaining"] = True
            mod = c[len(key):].split("@")[0].strip()
            if mod:
                seg["label"] = f"{key} {mod}"
            return seg
    if c.startswith("+ latihan gel"):
        return {"_note": c.lstrip("+ ").strip()}
    if c.startswith("🏆 RACE DAY"):
        return {"_note": "RACE DAY"}
    issue(week, day, "unparsed", f"baris tidak dikenali: '{c}'")
    return None


def _test_seg(c, **kw):
    """Tes/TT: effort maksimal rata -> tidak di-anchor ke pace profile.
    Pace di Excel disimpan sebagai panduan saja (src_pace)."""
    pm = PACE_RE.search(c); zm = ZONE_RE.search(c)
    return {"kind": "test", "intensity": "TEST", "hr_zone": norm_zone(zm.group(1)) if zm else "Z4-5",
            "src_pace": f"{pm.group(1)}–{pm.group(2)}" if pm else None, **kw}


def _hint_for_block(week, c):
    pm = PACE_RE.search(c)
    if not pm:
        return None
    zm = ZONE_RE.search(c)
    z = norm_zone(zm.group(1)) if zm else ""
    p = pace_s(pm.group(1))
    if z == "Z4":
        return "H"
    if z == "Z3":
        return "M"
    if z == "Z1":
        return "REC"
    if z == "Z1-2":
        return "WU"
    return "L"


def _drop_issues(week, day, kinds):
    for i in [x for x in issues if x["week"] == week and x["day"] == day and x["kind"] in kinds]:
        issues.remove(i)


def seg_km(seg, reps_parent=None):
    if seg.get("distance_m") is None:
        return 0.0
    return seg["distance_m"] * seg.get("reps", 1) / 1000


def mid_pace(week, seg):
    code = seg.get("intensity")
    prof = profile_for(week, code, seg.get("pace_variant")) if code in PACE_PROFILE else None
    if not prof:
        return None
    adj = seg.get("pace_adj_s", [0, 0])
    return ((prof[0] + adj[0]) + (prof[1] + adj[1])) / 2


def classify(day, segs, text):
    kinds = {(s["kind"], s.get("intensity")) for s in segs}
    if any(s["kind"] == "test" for s in segs):
        return "test_30min" if any(s.get("test_type") == "30min" for s in segs) else "tt_10k"
    if "RACE DAY" in text:
        return "race"
    work = [s for s in segs if s["kind"] == "work"]
    if day == "sat":
        if "Shake-out" in text:
            return "shakeout"
        hard_blocks = sum(seg_km(s) for s in segs if s.get("intensity") in ("M", "H") and s["kind"] in ("steady", "work"))
        if "SIMULASI" in text:
            return "long_race_sim"
        if "Progresif" in text:
            return "long_progressive"
        if hard_blocks > 0:
            return "long_with_pace"
        return "long"
    if work:
        codes = {s.get("intensity") for s in work}
        if any(s.get("label") == "Fartlek" for s in work):
            return "fartlek"
        if "N" in codes:
            return "vo2_4x4"
        if "T" in codes:
            return "tempo"
        if "H" in codes:
            return "hm_pace"
    if any(s["kind"] == "hill" for s in segs):
        return "easy_hill"
    if day == "sun":
        return "recovery"
    if any(s["kind"] == "strides" for s in segs):
        return "easy_strides"
    return "easy"


def main():
    wb = openpyxl.load_workbook(XLSX)
    ws = next(w for w in wb.worksheets if "Jadwal" in w.title)
    pz = next(w for w in wb.worksheets if "Pace & Zone" in w.title)
    lthr = pz["C6"].value

    weeks, sessions = [], []
    for r in range(4, 31):
        wlabel = ws[f"B{r}"].value
        week = int(wlabel[1:])
        start = ws[f"C{r}"].value.date()
        phase = ws[f"D{r}"].value
        color_head = ws[f"B{r}"].fill.fgColor.rgb[-6:]
        color_cell = ws[f"C{r}"].fill.fgColor.rgb[-6:]
        week_km = 0.0
        hard_days = []
        for day, (tc, kc, off) in DAY_COLS.items():
            text = ws[f"{tc}{r}"].value or ""
            planned = ws[f"{kc}{r}"].value
            planned = float(planned) if planned is not None else 0.0
            week_km += planned
            clauses, notes = preprocess(text)
            segs = []
            for cl in clauses:
                s = parse_clause(week, day, cl)
                if s is None:
                    continue
                if "_note" in s:
                    notes.append(s["_note"]); continue
                segs.append(s)
            # recovery antar rep: jumlah = reps-1 (diverifikasi vs km kolom)
            for i, s in enumerate(segs):
                if s["kind"] == "recovery" and s.get("intensity") in ("JOG",) or (s["kind"] == "recovery" and i > 0 and segs[i-1]["kind"] == "work"):
                    prev = next((p for p in reversed(segs[:i]) if p["kind"] == "work"), None)
                    if prev and prev.get("reps", 1) > 1 and "reps" not in s:
                        s["reps"] = prev["reps"] - 1
                        s["between_reps"] = True
            # isi sisa km untuk segmen tanpa jarak
            fixed = sum(seg_km(s) for s in segs if not s.get("fill_remaining") and s["kind"] not in ("strides", "hill"))
            fills = [s for s in segs if s.get("fill_remaining")]
            strides_km = sum(seg_km(s) for s in segs if s["kind"] == "strides")
            if fills:
                rem = round(planned - fixed - strides_km, 2)
                for s in fills:
                    s["distance_m"] = int(round(rem / len(fills) * 1000))
                computed = planned
            else:
                computed = round(fixed + strides_km, 2)
                if abs(computed - planned) > 0.5:
                    issue(week, day, "km_mismatch",
                          f"jumlah segmen {computed} km ≠ kolom km {planned} km",
                          "planned_km tetap pakai kolom Excel")
            # sesi keras
            stype = classify(day, segs, text)
            mp_hmp_km = sum(seg_km(s) for s in segs if s.get("intensity") in ("M", "H"))
            is_hard = stype in ("vo2_4x4", "tempo", "hm_pace", "test_30min", "tt_10k", "race") or (
                day == "sat" and mp_hmp_km >= 5)
            if is_hard:
                hard_days.append(day)
            # target Z4 (R12)
            z4 = None
            work_z4_min = round(sum(
                (mid_pace(week, s) or 0) * seg_km(s) / 60
                for s in segs if s["kind"] == "work" and s.get("hr_zone") and "4" in s["hr_zone"]
                and s.get("intensity") in ("T", "H")), 1)
            if day == "thu" and stype in ("tempo", "hm_pace"):
                z4 = z4_ladder(week)
            date = start + dt.timedelta(days=off)
            sessions.append({
                "id": f"W{week:02d}-{day}",
                "date": date.isoformat(), "week": week, "day": day, "phase": phase,
                "type": stype, "is_hard": is_hard, "planned_km": planned,
                "z4_target_min": z4,
                "z4_planned_min": work_z4_min or None,
                "mp_hmp_km": round(mp_hmp_km, 2) or None,
                "segments_km": computed, "segments": segs, "notes": notes, "source_text": text,
            })
        hard_n = len(hard_days)
        order = list(DAY_COLS)
        consec = any(order.index(b) - order.index(a) == 1 and DAY_COLS[b][2] - DAY_COLS[a][2] == 1
                     for a, b in zip(hard_days, hard_days[1:]))
        if hard_n > 2:
            issue(week, "-", "guardrail", f"{hard_n} sesi keras di minggu ini: {', '.join(hard_days)} (aturan maks 2)")
        if consec:
            issue(week, "-", "guardrail", f"2 hari keras berturut-turut: {', '.join(hard_days)}")
        exception = None
        if hard_n > 2:
            exception = {"rule": "R8_max_hard", "status": "pending_decision",
                         "decision_ref": "D6" if week == 27 else "D5"}
        weeks.append({
            "guardrail_exception": exception,
            "week": week, "start": start.isoformat(), "phase": phase,
            "is_recovery_week": week in RECOVERY_WEEKS, "is_taper": week >= 25,
            "planned_km": round(week_km, 1), "hard_sessions": hard_days,
            "color": {"header": f"#{color_head}", "cell": f"#{color_cell}"},
        })

    for s_ in sessions:
        for g in s_["segments"]:
            g.pop("review", None)
    plan = {
        "meta": {
            "decisions": {"approved": "2026-11-17", "D1": "TJOG 390–420", "D2": "L + pace_adj_s",
                          "D3": "fartlek: N + adj, hr_zone null, is_hard false",
                          "D4": "N pace_variant base (W02)", "D5": "pending", "D6": "pending",
                          "D7": "race/strides: H/S + adj", "D8": "z4_target_min = tangga",
                          "D9": "planned_km = kolom Excel", "D10": "tes 30′ jarak estimasi",
                          "D11": "pakai WU bila cocok persis"},
            "source": XLSX.name, "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
            "athlete": "Tyrone", "race": {"name": "Half Marathon", "date": "2027-05-30",
                                            "distance_m": 21097.5, "goal_time_s": 6299, "goal_pace_s": 298},
            "program_start": "2026-11-23", "weeks": 27, "lthr": lthr,
        },
        "pace_profile": {
            "version": 1,
            "default": {k: list(v) for k, v in PACE_PROFILE.items()},
            "base_phase": {"weeks": [3, 8], **{k: list(v) for k, v in PACE_PROFILE_BASE.items()}},
        },
        "hr_zones_pct_lthr": {"Z1": [0, 84], "Z2": [85, 89], "Z3": [90, 94], "Z4": [95, 100], "Z5": [101, 106]},
        "z4_ladder": [{"weeks": [4, 6], "min": 20}, {"weeks": [7, 11], "min": 30},
                      {"weeks": [12, 13], "min": 40}, {"weeks": [15, 24], "hmp_block_km": [9, 12]}],
        "recovery_weeks": sorted(RECOVERY_WEEKS),
        "vo2_weeks_w15_w24": [17, 20, 22],
        "weeks": weeks,
        "sessions": sessions,
        "strength_template": {
            "mon": "Upper – Shoulder + core", "tue": "Low Bar Squat + Quads (SORE, ≥6 jam setelah lari)",
            "thu": "Deadlift + Hamstring/Glute (SORE)", "fri": "Upper – Chest",
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(plan)
    print(f"OK: {len(sessions)} sesi, {len(issues)} catatan -> {OUT.relative_to(ROOT)}")


def resolve(week, seg):
    code = seg.get("intensity")
    if code not in PACE_PROFILE:
        return "effort ±90%" if code == "HILL" else ""
    lo, hi = profile_for(week, code, seg.get("pace_variant"))
    a = seg.get("pace_adj_s", [0, 0])
    return f"{fmt(lo + a[0])}–{fmt(hi + a[1])}"


def zone_bpm(z, lthr):
    if not z:
        return ""
    pct = {"Z1": (0, 84), "Z2": (85, 89), "Z3": (90, 94), "Z4": (95, 100), "Z5": (101, 106)}
    parts = z.replace("Z", "").split("-")
    lo = pct["Z" + parts[0]][0]; hi = pct["Z" + parts[-1]][1]
    return f"≤{round(lthr*hi/100)}" if lo == 0 else f"{round(lthr*lo/100)}–{round(lthr*hi/100)}"


def describe(seg, week, lthr):
    k = seg["kind"]
    d = seg.get("distance_m")
    dist = (f"{d/1000:g} km" if d and d >= 1000 else f"{d} m") if d else ""
    reps = f"{seg['reps']}×" if seg.get("reps", 1) > 1 or (k == "work" and seg.get("reps")) else ""
    if k == "hill":
        return f"hill {seg['reps']}×{seg['duration_s']} dtk, effort ±90%"
    if k == "test" and seg.get("duration_s"):
        dist = "30 menit"
    flag = " ⚠review" if seg.get("review") else ""
    adj = f" adj{seg['pace_adj_s']}" if seg.get("pace_adj_s") else ""
    var = " (base)" if seg.get("pace_variant") else ""
    bpm = zone_bpm(seg.get("hr_zone"), lthr)
    return (f"{k:<9} {reps}{dist:<8} {seg.get('intensity','?')}{var}{adj} → {resolve(week, seg)}"
            f" [{seg.get('hr_zone') or '-'}{' ' + bpm + ' bpm' if bpm else ''}]{flag}")


def write_report(plan):
    lthr = plan["meta"]["lthr"]
    L = ["# Parse report — Program_HM_Sub145_Mei2027.xlsx", "",
         f"Sesi: {len(plan['sessions'])} • Minggu: {len(plan['weeks'])} • LTHR: {lthr}", ""]
    L.append("## Catatan / hal yang butuh keputusan")
    L.append("")
    L.append("| Mgg | Hari | Jenis | Teks | Usulan |")
    L.append("|---|---|---|---|---|")
    for i in issues:
        L.append(f"| W{i['week']:02d} | {i['day']} | {i['kind']} | {i['text']} | {i['proposal'] or ''} |")
    L.append("")
    L.append("## Ringkasan per minggu")
    L.append("")
    L.append("| Mgg | Mulai | Fase | km | Sesi keras |")
    L.append("|---|---|---|---|---|")
    for w in plan["weeks"]:
        L.append(f"| W{w['week']:02d} | {w['start']} | {w['phase']}{' (pemulihan)' if w['is_recovery_week'] else ''} | {w['planned_km']} | {', '.join(w['hard_sessions'])} |")
    L.append("")
    for wk in (2, 5, 12, 24):
        w = plan["weeks"][wk - 1]
        L.append(f"## Contoh W{wk:02d} — {w['phase']} — mulai {w['start']} — {w['planned_km']} km")
        L.append("")
        for s in [s for s in plan["sessions"] if s["week"] == wk]:
            hard = " ⭐KERAS" if s["is_hard"] else ""
            z4 = f" • target Z4 {s['z4_target_min']}′" if s["z4_target_min"] else ""
            z4p = f" • Z4 terencana ±{s['z4_planned_min']}′" if s["z4_planned_min"] else ""
            L.append(f"**{s['day'].upper()} {s['date']} — {s['type']} — {s['planned_km']} km{hard}{z4}{z4p}**")
            L.append("```")
            for seg in s["segments"]:
                L.append(describe(seg, wk, lthr))
            for n in s["notes"]:
                L.append(f"note: {n}")
            L.append("```")
        L.append("")
    REPORT.write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
