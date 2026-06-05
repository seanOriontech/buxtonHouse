"""Pure detection algorithms — no I/O, all callers feed in arrays.

Three signals, all per-entity (apartment or communal room):
  1. spike_flag    — today vs this entity's own last-14-days baseline (median + IQR)
  2. leak_flag     — sustained overnight water flow (water-only, Apartment Living)
  3. dow_flag      — today vs this entity's typical value for this day-of-week

Robust statistics (median, MAD, IQR) — small cohort + skewed daily values
mean a few high days would skew the mean + stdev too easily.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass
from typing import Literal, Sequence

Severity = Literal["amber", "red"]


@dataclass(frozen=True)
class BaselineStats:
    median: float
    q1: float
    q3: float
    iqr: float
    mad: float          # median absolute deviation


def baseline_stats(values: Sequence[float]) -> BaselineStats | None:
    """Robust baseline from a list of daily per-person values.

    Returns None if the sample is too small (<5 points) — we don't want to
    flag against a 2-day baseline.
    """
    vals = [v for v in values if v is not None]
    if len(vals) < 5:
        return None
    s = sorted(vals)
    median = statistics.median(s)
    q1 = statistics.median(s[: len(s) // 2])
    q3 = statistics.median(s[(len(s) + 1) // 2 :])
    iqr = q3 - q1
    mad = statistics.median([abs(v - median) for v in s])
    return BaselineStats(median=median, q1=q1, q3=q3, iqr=iqr, mad=mad)


@dataclass(frozen=True)
class SpikeOutcome:
    severity: Severity | None
    today: float
    baseline_median: float
    threshold_amber: float
    threshold_red: float
    robust_z: float


def spike_flag(today: float, stats: BaselineStats | None) -> SpikeOutcome | None:
    """Returns a SpikeOutcome if either threshold trips, else None."""
    if stats is None:
        return None
    # Floor IQR at 20% of the median so a near-constant baseline still has a
    # meaningful spread to test against; otherwise tiny natural variation in a
    # stable baseline would trip the amber threshold.
    effective_iqr = max(stats.iqr, stats.median * 0.2)
    threshold_amber = stats.q3 + 1.5 * effective_iqr
    threshold_red   = stats.q3 + 3.0 * effective_iqr
    # Robust Z-score using MAD (1.4826 makes it consistent with stdev for normal data).
    robust_z = ((today - stats.median) / (stats.mad * 1.4826)) if stats.mad > 0 else 0.0

    severity: Severity | None = None
    if today >= threshold_red:
        severity = "red"
    elif today >= threshold_amber:
        severity = "amber"
    if severity is None:
        return None
    return SpikeOutcome(
        severity=severity,
        today=today,
        baseline_median=stats.median,
        threshold_amber=threshold_amber,
        threshold_red=threshold_red,
        robust_z=robust_z,
    )


@dataclass(frozen=True)
class LeakOutcome:
    severity: Severity
    avg_overnight_litres: float
    consecutive_nights: int
    peak_night_litres: float
    nights_over_threshold: int
    threshold_litres: float


def leak_flag(
    overnight_per_night: Sequence[float],   # oldest → newest, last 7 nights typical
    threshold_litres: float = 5.0,
    consecutive_red: int = 3,
) -> LeakOutcome | None:
    """Sustained overnight water flow ⇒ likely leak. Amber on single offending
    night, red on `consecutive_red` (default 3) in a row at the tail."""
    nights = list(overnight_per_night)
    if not nights:
        return None
    avg = sum(nights) / len(nights)
    peak = max(nights)
    nights_over = sum(1 for n in nights if n > threshold_litres)
    # Trailing-consecutive count
    tail_consec = 0
    for n in reversed(nights):
        if n > threshold_litres:
            tail_consec += 1
        else:
            break

    severity: Severity | None = None
    if tail_consec >= consecutive_red:
        severity = "red"
    elif nights_over >= 1:
        severity = "amber"
    if severity is None:
        return None
    return LeakOutcome(
        severity=severity,
        avg_overnight_litres=avg,
        consecutive_nights=tail_consec,
        peak_night_litres=peak,
        nights_over_threshold=nights_over,
        threshold_litres=threshold_litres,
    )


@dataclass(frozen=True)
class DowOutcome:
    severity: Severity | None
    today: float
    dow_median: float
    ratio: float


def dow_flag(today: float, same_dow_history: Sequence[float]) -> DowOutcome | None:
    """Today vs this entity's typical value for this day-of-week.

    Needs ≥ 3 same-DOW samples for the median to mean anything.
    """
    hist = [v for v in same_dow_history if v is not None and v > 0]
    if len(hist) < 3:
        return None
    dow_median = statistics.median(hist)
    if dow_median <= 0:
        return None
    ratio = today / dow_median

    severity: Severity | None = None
    if ratio >= 3.0:
        severity = "red"
    elif ratio >= 2.0:
        severity = "amber"
    if severity is None:
        return None
    return DowOutcome(
        severity=severity,
        today=today,
        dow_median=dow_median,
        ratio=ratio,
    )


def composite_score(
    spike_zs: Sequence[float],          # robust_z values for utilities that spiked
    dow_ratios_minus_one: Sequence[float],   # max(ratio - 1, 0) for utilities flagged
    leak_consecutive: int = 0,
    leak_weight: float = 2.0,
) -> float:
    """Aggregate the three signals into one sortable score."""
    return (
        sum(max(z, 0.0) for z in spike_zs)
        + leak_weight * leak_consecutive
        + sum(max(r, 0.0) for r in dow_ratios_minus_one)
    )
