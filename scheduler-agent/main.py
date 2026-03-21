#!/usr/bin/env python3
"""
main.py — AI Scheduling Agent entry point.

Orchestrates:
  1. Read reminders from Apple Reminders (or demo data)
  2. Load calendar availability from iCal URL
  3. Classify each task with Claude
  4. Generate a structured action plan with Claude
  5. Print and save the action plan as JSON
"""

from __future__ import annotations

import json
import os
import platform
import sys
from datetime import date, datetime
from pathlib import Path

from dotenv import load_dotenv

# Load .env before importing anything that reads env vars
load_dotenv()

from src.classifier import TaskClassifier
from src.planner import ActionPlanner

# ---------------------------------------------------------------------------
# Config from environment
# ---------------------------------------------------------------------------

ICAL_URL = os.getenv("ICAL_URL", "")
REMINDERS_LIST = os.getenv("REMINDERS_LIST", "Booking Tasks")
WINDOW_START = int(os.getenv("SCHEDULE_WINDOW_START", "9"))
WINDOW_END = int(os.getenv("SCHEDULE_WINDOW_END", "18"))
BUFFER_MINUTES = int(os.getenv("BUFFER_MINUTES", "30"))
LOOKAHEAD_DAYS = int(os.getenv("LOOKAHEAD_DAYS", "30"))
TIMEZONE = os.getenv("TIMEZONE", "America/New_York")

_default_output = Path(__file__).parent / "outputs" / "action_plan.json"
OUTPUT_PATH = Path(os.getenv("OUTPUT_PATH", str(_default_output)))


# ---------------------------------------------------------------------------
# Pretty printing helpers
# ---------------------------------------------------------------------------

PRIORITY_COLORS = {"HIGH": "\033[91m", "MEDIUM": "\033[93m", "LOW": "\033[92m"}
RESET = "\033[0m"
BOLD = "\033[1m"


def _color(text: str, code: str) -> str:
    return f"{code}{text}{RESET}"


def print_plan(plan_dict: dict) -> None:
    items = plan_dict.get("items", [])
    print(f"\n{BOLD}{'='*65}{RESET}")
    print(f"{BOLD}  AI SCHEDULING ACTION PLAN{RESET}")
    print(f"  Generated: {plan_dict.get('generated_at', 'unknown')}")
    print(f"  Tasks: {plan_dict.get('total_tasks', len(items))}")
    print(f"{BOLD}{'='*65}{RESET}\n")

    for i, item in enumerate(items, 1):
        priority = item.get("priority", "MEDIUM")
        p_color = PRIORITY_COLORS.get(priority, "")
        print(f"{BOLD}[{i}] {item['task_name']}{RESET}")
        print(f"    Type     : {item.get('task_type', '?')}")
        print(f"    Priority : {_color(priority, p_color)} — {item.get('priority_reason', '')}")
        print(f"    Duration : ~{item.get('estimated_duration_minutes', '?')} min")
        print(f"    Platform : {item.get('recommended_platform', '?')}")
        if item.get("platform_url"):
            print(f"    URL      : {item['platform_url']}")
        print(f"    Action   : {item.get('recommended_action', '')}")

        windows = item.get("suggested_time_windows", [])
        if windows:
            print(f"    Suggested windows:")
            for w in windows:
                print(f"      • {w['date']}  {w['start_time']}–{w['end_time']}  ({w.get('reason','')})")

        if item.get("notes"):
            print(f"    Notes    : {item['notes']}")
        print()


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main() -> int:
    print(f"{BOLD}AI Scheduling Agent{RESET}")
    print("─" * 40)

    # ── Step 1: Load reminders ──────────────────────────────────────────────
    print("📋 Loading reminders…")
    reminders: list[dict] = []

    if platform.system() == "Darwin":
        try:
            from src.reminders import get_reminders
            reminders = get_reminders(REMINDERS_LIST)
            print(f"   Found {len(reminders)} incomplete reminder(s) in '{REMINDERS_LIST}'.")
        except Exception as exc:
            print(f"   ⚠️  Could not read Apple Reminders: {exc}")
            print("   Falling back to demo reminders.")
    else:
        print("   (Non-macOS system — using demo reminders)")

    if not reminders:
        from src.reminders import get_demo_reminders
        reminders = get_demo_reminders()
        print(f"   Using {len(reminders)} demo reminder(s).")

    if not reminders:
        print("No reminders found. Nothing to do.")
        return 0

    # ── Step 2: Load calendar availability ─────────────────────────────────
    availability: list[dict] = []

    if ICAL_URL:
        print(f"\n📅 Loading calendar from iCal URL…")
        try:
            from src.calendar_reader import CalendarReader
            reader = CalendarReader(
                ical_url=ICAL_URL,
                timezone=TIMEZONE,
                window_start_hour=WINDOW_START,
                window_end_hour=WINDOW_END,
                buffer_minutes=BUFFER_MINUTES,
                lookahead_days=LOOKAHEAD_DAYS,
            )
            reader.load()
            availability = reader.summarize_availability(max_days=14)
            total_slots = sum(len(d["free_slots"]) for d in availability)
            print(f"   Found {total_slots} free slot(s) across {len(availability)} day(s).")
        except Exception as exc:
            print(f"   ⚠️  Could not load calendar: {exc}")
            print("   Proceeding without calendar data.")
    else:
        print("\n📅 No ICAL_URL set — skipping calendar check.")
        print("   (Set ICAL_URL in .env to enable free/busy analysis)")

    # ── Step 3: Classify tasks ──────────────────────────────────────────────
    print(f"\n🤖 Classifying {len(reminders)} task(s) with Claude…")
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY is not set. Add it to your .env file.")
        return 1

    classifier = TaskClassifier(model="claude-sonnet-4-6")
    classified = classifier.classify(reminders)

    for ct in classified:
        print(f"   [{ct.task_type:10s}] {ct.task_name}  (confidence: {ct.confidence:.0%})")

    # ── Step 4: Generate action plan ────────────────────────────────────────
    print(f"\n📝 Generating action plan…")
    planner = ActionPlanner(model="claude-sonnet-4-6")
    today_str = date.today().isoformat()

    plan = planner.generate(
        classified_tasks=classified,
        availability=availability,
        today=today_str,
        lookahead_days=LOOKAHEAD_DAYS,
    )

    plan_dict = ActionPlanner.plan_to_dict(plan)

    # ── Step 5: Output ──────────────────────────────────────────────────────
    print_plan(plan_dict)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(plan_dict, f, indent=2, default=str)

    print(f"✅ Action plan saved to: {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
