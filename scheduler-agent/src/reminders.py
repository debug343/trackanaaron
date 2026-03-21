"""
reminders.py — Read incomplete reminders from Apple Reminders via AppleScript.

Requires macOS. Returns a list of reminder dicts with name, notes, and due date.
"""

import subprocess
import json
import platform
from datetime import datetime
from typing import Optional


APPLESCRIPT_TEMPLATE = """
tell application "Reminders"
    set taskList to {}
    set targetList to list "{list_name}"
    set incompleteReminders to (reminders of targetList whose completed is false)
    repeat with r in incompleteReminders
        set reminderName to name of r
        set reminderNotes to ""
        try
            set reminderNotes to body of r
            if reminderNotes is missing value then set reminderNotes to ""
        end try
        set reminderDue to ""
        try
            set dueDate to due date of r
            if dueDate is not missing value then
                set reminderDue to ((year of dueDate as string) & "-" & \\
                    text -2 thru -1 of ("0" & (month of dueDate as integer) as string) & "-" & \\
                    text -2 thru -1 of ("0" & (day of dueDate as string)))
            end if
        end try
        set end of taskList to (reminderName & "||" & reminderNotes & "||" & reminderDue)
    end repeat
    return taskList
end tell
"""


def _run_applescript(script: str) -> str:
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"AppleScript error (exit {result.returncode}): {result.stderr.strip()}"
        )
    return result.stdout.strip()


def _parse_applescript_list(raw: str) -> list[dict]:
    """
    AppleScript returns a comma-separated string of items when a list is
    returned via `osascript`. Each item is: name||notes||due_date
    """
    if not raw:
        return []

    reminders = []
    # osascript separates list items with ", " — but names/notes may contain commas,
    # so we delimit fields with || and split items on ||...<newline> boundaries.
    # A safer approach: each list item is on its own output line when using -ss flag.
    # We use a distinct separator instead.
    for item in raw.split(", "):
        item = item.strip()
        if not item:
            continue
        parts = item.split("||")
        name = parts[0].strip() if len(parts) > 0 else ""
        notes = parts[1].strip() if len(parts) > 1 else ""
        due_str = parts[2].strip() if len(parts) > 2 else ""
        due_date: Optional[datetime] = None
        if due_str:
            try:
                due_date = datetime.strptime(due_str, "%Y-%m-%d")
            except ValueError:
                pass
        if name:
            reminders.append(
                {
                    "name": name,
                    "notes": notes,
                    "due_date": due_date.isoformat() if due_date else None,
                    "raw": item,
                }
            )
    return reminders


def get_reminders(list_name: str = "Booking Tasks") -> list[dict]:
    """
    Fetch incomplete reminders from the named Apple Reminders list.

    Returns a list of dicts:
        {
            "name": str,
            "notes": str,
            "due_date": str | None,   # ISO-8601 date or None
            "raw": str                # original AppleScript output line
        }

    Raises:
        RuntimeError  if not on macOS or AppleScript fails.
        FileNotFoundError  if the Reminders list does not exist.
    """
    if platform.system() != "Darwin":
        raise RuntimeError(
            "Apple Reminders integration requires macOS. "
            "On non-Mac systems, populate reminders manually via the DEMO_REMINDERS "
            "environment variable or use get_demo_reminders()."
        )

    script = APPLESCRIPT_TEMPLATE.format(list_name=list_name.replace('"', '\\"'))
    raw = _run_applescript(script)
    reminders = _parse_applescript_list(raw)
    return reminders


def get_demo_reminders() -> list[dict]:
    """
    Return a hard-coded set of sample reminders for testing on non-macOS systems
    or when the Reminders app is unavailable.
    """
    return [
        {
            "name": "Book annual physical with Dr. Smith",
            "notes": "Need to schedule before end of year. Preferred morning slots.",
            "due_date": None,
            "raw": "demo",
        },
        {
            "name": "Fix leaky kitchen faucet",
            "notes": "Dripping steadily, probably needs new washer or plumber.",
            "due_date": None,
            "raw": "demo",
        },
        {
            "name": "Schedule dentist cleaning for kids",
            "notes": "Both kids due for 6-month checkup. Emma and Liam.",
            "due_date": None,
            "raw": "demo",
        },
        {
            "name": "Get car oil change",
            "notes": "Overdue by 2k miles. Quick Lube on Main Street.",
            "due_date": None,
            "raw": "demo",
        },
        {
            "name": "Find after-school tutor for math",
            "notes": "7th grade algebra. Twice a week ideally.",
            "due_date": None,
            "raw": "demo",
        },
    ]
