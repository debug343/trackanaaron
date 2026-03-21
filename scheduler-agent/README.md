# AI Scheduling Agent

A personal AI assistant that reads your Apple Reminders, checks your calendar availability, classifies each task, and produces a structured action plan — all powered by Claude (`claude-sonnet-4-6`) via LangChain.

## What it does

1. **Reads** incomplete reminders from an Apple Reminders list called `Booking Tasks` (via AppleScript on macOS)
2. **Parses** your iCal calendar (Google Calendar, iCloud, etc.) to find free/busy slots over the next 30 days
3. **Classifies** each reminder into `MEDICAL`, `HOUSEHOLD`, `CHILDCARE`, or `OTHER` using Claude
4. **Generates** a structured JSON action plan with suggested time windows, recommended platforms, and priority scores
5. **Outputs** the plan to the console and to `outputs/action_plan.json`

## Project structure

```
scheduler-agent/
├── main.py                  # Entry point — run this
├── src/
│   ├── __init__.py
│   ├── reminders.py         # Apple Reminders via AppleScript
│   ├── calendar_reader.py   # iCal parsing + free/busy logic
│   ├── classifier.py        # LangChain + Claude task classifier
│   └── planner.py           # LangChain + Claude action plan generator
├── outputs/
│   └── action_plan.json     # Generated output (created at runtime)
├── requirements.txt
├── .env.example
└── README.md
```

## Requirements

- **Python 3.11+**
- **macOS** for live Apple Reminders (non-Mac systems use built-in demo data)
- An **Anthropic API key** — [get one here](https://console.anthropic.com/)

## Setup

### 1. Clone / copy the project

```bash
cd /Users/brewdio/Desktop/Dev
# project is already at scheduler-agent/
cd scheduler-agent
```

### 2. Create a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ Yes | Your Anthropic API key |
| `ICAL_URL` | Recommended | iCal URL for your calendar (see below) |
| `REMINDERS_LIST` | No | Reminders list name (default: `Booking Tasks`) |
| `TIMEZONE` | No | IANA timezone (default: `America/New_York`) |
| `SCHEDULE_WINDOW_START` | No | Start of schedulable day, 24h (default: `9`) |
| `SCHEDULE_WINDOW_END` | No | End of schedulable day, 24h (default: `18`) |
| `BUFFER_MINUTES` | No | Travel buffer between appointments (default: `30`) |
| `LOOKAHEAD_DAYS` | No | Days ahead to scan (default: `30`) |
| `OUTPUT_PATH` | No | Override output file path |

### 5. Get your iCal URL

**Google Calendar:**
1. Open Google Calendar → Settings → click your calendar name
2. Scroll to "Integrate calendar"
3. Copy the **"Secret address in iCal format"** link
4. Paste as `ICAL_URL` in your `.env`

**iCloud Calendar:**
1. Open Calendar on Mac → right-click a calendar → Share Calendar
2. Enable public calendar, copy the link
3. Change `webcal://` to `https://` and paste as `ICAL_URL`

### 6. Set up Apple Reminders (macOS)

1. Open the **Reminders** app
2. Create a new list called **`Booking Tasks`** (or whatever name you set in `REMINDERS_LIST`)
3. Add your tasks as individual reminders, e.g.:
   - "Book annual physical with Dr. Smith"
   - "Fix leaky kitchen faucet"
   - "Schedule dentist for kids"

> On first run, macOS may ask for permission to allow Terminal to access Reminders — click **OK**.

## Running

```bash
python main.py
```

The agent will:
- Print classified tasks to the console
- Print the full action plan with colored priority indicators
- Save `outputs/action_plan.json`

### Demo mode (no macOS / no iCal URL)

If you're on a non-Mac system or haven't set `ICAL_URL`, the agent runs in demo mode with sample reminders and no calendar data. This is useful for testing your API key and the pipeline.

## Output format

`outputs/action_plan.json` contains an array of action items:

```json
{
  "generated_at": "2024-03-15T10:30:00",
  "total_tasks": 3,
  "items": [
    {
      "task_name": "Book annual physical with Dr. Smith",
      "task_type": "MEDICAL",
      "priority": "HIGH",
      "priority_reason": "Annual physicals are preventive care — delay can affect long-term health.",
      "suggested_time_windows": [
        {
          "date": "2024-03-18",
          "start_time": "09:00",
          "end_time": "10:30",
          "reason": "Morning slot minimizes fasting window if labs are needed."
        }
      ],
      "recommended_platform": "Zocdoc",
      "platform_url": "https://www.zocdoc.com",
      "recommended_action": "Search Zocdoc for primary care physicians accepting new patients in your ZIP code.",
      "estimated_duration_minutes": 60,
      "notes": "Bring insurance card and list of current medications."
    }
  ]
}
```

## Troubleshooting

| Problem | Solution |
|---|---|
| `ANTHROPIC_API_KEY is not set` | Add it to your `.env` file |
| AppleScript error on first run | Grant Terminal access to Reminders in System Settings → Privacy & Security → Automation |
| `Reminders list not found` | Check that your list name matches `REMINDERS_LIST` in `.env` exactly (case-sensitive) |
| iCal URL fetch error | Verify the URL is accessible in a browser; some require authentication |
| Empty free slots | Check that `ICAL_URL` is correct and your calendar has events in the lookahead window |

## Tech stack

| Library | Purpose |
|---|---|
| `anthropic` | Anthropic Claude API client |
| `langchain` + `langchain-anthropic` | LLM orchestration and prompt chaining |
| `icalendar` | .ics file parsing |
| `recurring-ical-events` | Recurring event expansion |
| `pytz` + `zoneinfo` | Timezone handling |
| `requests` | HTTP client for iCal URL fetch |
| `python-dotenv` | `.env` file loading |
| `pydantic` | Structured output validation |
