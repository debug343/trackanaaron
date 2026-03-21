"""
calendar_reader.py — Parse an iCal feed and compute free/busy windows.

Fetches a remote .ics file, extracts events for the next N days,
and returns a list of free slots within a configurable daily window
(default 9 am–6 pm) with travel/buffer padding between appointments.
"""

import os
from datetime import date, datetime, timedelta, time
from zoneinfo import ZoneInfo
from typing import Optional

import requests
import pytz
from icalendar import Calendar, Event
import recurring_ical_events


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_aware_datetime(dt_or_date, tz: ZoneInfo) -> datetime:
    """Coerce a date or naive datetime to an aware datetime in *tz*."""
    if isinstance(dt_or_date, datetime):
        if dt_or_date.tzinfo is None:
            return dt_or_date.replace(tzinfo=tz)
        return dt_or_date.astimezone(tz)
    # plain date → midnight
    return datetime(dt_or_date.year, dt_or_date.month, dt_or_date.day, tzinfo=tz)


def _fetch_ical(url: str, timeout: int = 15) -> bytes:
    """Download an iCal feed. Converts webcal:// to https://."""
    url = url.strip()
    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.content


# ---------------------------------------------------------------------------
# Core classes
# ---------------------------------------------------------------------------

class BusyBlock:
    """A single busy interval (with optional buffer padding applied)."""

    def __init__(self, start: datetime, end: datetime, summary: str = ""):
        self.start = start
        self.end = end
        self.summary = summary

    def __repr__(self) -> str:
        return f"BusyBlock({self.start:%Y-%m-%d %H:%M} – {self.end:%H:%M} '{self.summary}')"


class FreeSlot:
    """A contiguous free window within the scheduling day."""

    def __init__(self, start: datetime, end: datetime):
        self.start = start
        self.end = end

    @property
    def duration_minutes(self) -> int:
        return int((self.end - self.start).total_seconds() / 60)

    def to_dict(self) -> dict:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "duration_minutes": self.duration_minutes,
        }

    def __repr__(self) -> str:
        return (
            f"FreeSlot({self.start:%Y-%m-%d %H:%M} – {self.end:%H:%M}, "
            f"{self.duration_minutes} min)"
        )


class CalendarReader:
    """
    Reads an iCal feed and exposes free slots over a lookahead window.

    Parameters
    ----------
    ical_url : str
        URL of the .ics feed (http/https/webcal).
    timezone : str
        IANA timezone name, e.g. "America/New_York".
    window_start_hour : int
        Start of schedulable day (inclusive), 24-h. Default 9.
    window_end_hour : int
        End of schedulable day (exclusive), 24-h. Default 18.
    buffer_minutes : int
        Minutes of buffer to add before AND after each busy event. Default 30.
    lookahead_days : int
        Number of days from today to scan. Default 30.
    """

    def __init__(
        self,
        ical_url: str,
        timezone: str = "America/New_York",
        window_start_hour: int = 9,
        window_end_hour: int = 18,
        buffer_minutes: int = 30,
        lookahead_days: int = 30,
    ):
        self.ical_url = ical_url
        self.tz = ZoneInfo(timezone)
        self.window_start_hour = window_start_hour
        self.window_end_hour = window_end_hour
        self.buffer_minutes = timedelta(minutes=buffer_minutes)
        self.lookahead_days = lookahead_days
        self._calendar: Optional[Calendar] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Fetch and parse the iCal feed. Call once before querying slots."""
        raw = _fetch_ical(self.ical_url)
        self._calendar = Calendar.from_ical(raw)

    def get_busy_blocks(self, start_date: date, end_date: date) -> list[BusyBlock]:
        """
        Return all events (including recurring) between start_date and end_date,
        expanded to aware datetimes in self.tz and padded with buffer time.
        """
        if self._calendar is None:
            raise RuntimeError("Call CalendarReader.load() before querying.")

        start_dt = datetime(start_date.year, start_date.month, start_date.day, tzinfo=self.tz)
        end_dt = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59, tzinfo=self.tz)

        raw_events = recurring_ical_events.of(self._calendar).between(start_dt, end_dt)

        blocks: list[BusyBlock] = []
        for component in raw_events:
            if not isinstance(component, Event):
                continue
            dtstart = component.get("DTSTART")
            dtend = component.get("DTEND")
            if dtstart is None or dtend is None:
                continue

            ev_start = _to_aware_datetime(dtstart.dt, self.tz)
            ev_end = _to_aware_datetime(dtend.dt, self.tz)
            summary = str(component.get("SUMMARY", ""))

            # Apply buffer padding
            padded_start = ev_start - self.buffer_minutes
            padded_end = ev_end + self.buffer_minutes

            blocks.append(BusyBlock(padded_start, padded_end, summary))

        # Sort by start time
        blocks.sort(key=lambda b: b.start)
        return blocks

    def get_free_slots(
        self,
        min_duration_minutes: int = 60,
        start_date: Optional[date] = None,
    ) -> dict[str, list[FreeSlot]]:
        """
        Compute free slots for each day in the lookahead window.

        Returns a dict keyed by ISO date string → list of FreeSlot.
        Only slots at least *min_duration_minutes* long are included.
        """
        today = start_date or date.today()
        end_date = today + timedelta(days=self.lookahead_days)

        busy = self.get_busy_blocks(today, end_date)

        result: dict[str, list[FreeSlot]] = {}
        current = today
        while current <= end_date:
            day_key = current.isoformat()
            day_start = datetime(
                current.year, current.month, current.day,
                self.window_start_hour, 0, tzinfo=self.tz
            )
            day_end = datetime(
                current.year, current.month, current.day,
                self.window_end_hour, 0, tzinfo=self.tz
            )

            # Collect busy blocks that overlap this day's window
            day_busy = [
                b for b in busy
                if b.start < day_end and b.end > day_start
            ]

            # Merge overlapping blocks
            merged = _merge_blocks(day_busy)

            # Find gaps
            free: list[FreeSlot] = []
            cursor = day_start
            for block in merged:
                block_start = max(block.start, day_start)
                block_end = min(block.end, day_end)
                if cursor < block_start:
                    slot = FreeSlot(cursor, block_start)
                    if slot.duration_minutes >= min_duration_minutes:
                        free.append(slot)
                cursor = max(cursor, block_end)

            # Trailing free time
            if cursor < day_end:
                slot = FreeSlot(cursor, day_end)
                if slot.duration_minutes >= min_duration_minutes:
                    free.append(slot)

            if free:
                result[day_key] = free

            current += timedelta(days=1)

        return result

    def summarize_availability(self, max_days: int = 14) -> list[dict]:
        """
        Return a compact list of the first *max_days* days that have free slots,
        suitable for passing to the LLM as context.
        """
        slots_by_day = self.get_free_slots()
        summary = []
        for day_key in sorted(slots_by_day.keys())[:max_days]:
            slots = slots_by_day[day_key]
            summary.append(
                {
                    "date": day_key,
                    "free_slots": [s.to_dict() for s in slots],
                }
            )
        return summary


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _merge_blocks(blocks: list[BusyBlock]) -> list[BusyBlock]:
    """Merge overlapping or adjacent busy blocks."""
    if not blocks:
        return []
    merged = [blocks[0]]
    for b in blocks[1:]:
        last = merged[-1]
        if b.start <= last.end:
            merged[-1] = BusyBlock(last.start, max(last.end, b.end), last.summary)
        else:
            merged.append(b)
    return merged
