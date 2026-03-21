"""
planner.py — Generate a structured action plan from classified tasks + free slots.

Uses Claude via LangChain to produce a richly detailed JSON action plan for each
task, recommending platforms, time windows, and priority scores.
"""

from __future__ import annotations

import json
from typing import Literal, Optional

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .classifier import ClassifiedTask, TaskType


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

Priority = Literal["HIGH", "MEDIUM", "LOW"]


class SuggestedTimeWindow(BaseModel):
    date: str = Field(description="ISO date string, e.g. 2024-03-15")
    start_time: str = Field(description="Start time in HH:MM 24-hour format")
    end_time: str = Field(description="End time in HH:MM 24-hour format")
    reason: str = Field(description="Why this window was chosen")


class ActionItem(BaseModel):
    task_name: str
    task_type: TaskType
    priority: Priority
    priority_reason: str = Field(description="One sentence explaining the priority level.")
    suggested_time_windows: list[SuggestedTimeWindow] = Field(
        description="Up to 3 suggested booking windows from the available free slots.",
        max_length=3,
    )
    recommended_platform: str = Field(
        description=(
            "Best platform or action to book/complete this task. "
            "Examples: Zocdoc, ZocDoc, TaskRabbit, Thumbtack, Google Search, "
            "Phone call, Email draft, Care.com, Wyzant."
        )
    )
    platform_url: Optional[str] = Field(
        default=None,
        description="Direct URL for the recommended platform, if applicable."
    )
    recommended_action: str = Field(
        description=(
            "Concrete next step the user should take, e.g. "
            "'Search Zocdoc for primary care physicians accepting new patients in your ZIP code.'"
        )
    )
    estimated_duration_minutes: int = Field(
        description="Estimated total appointment or task duration in minutes."
    )
    notes: str = Field(
        default="",
        description="Any additional tips, reminders, or considerations."
    )


class ActionPlan(BaseModel):
    generated_at: str = Field(description="ISO datetime when this plan was generated.")
    total_tasks: int
    items: list[ActionItem]


# ---------------------------------------------------------------------------
# Platform lookup (used as context for the LLM prompt)
# ---------------------------------------------------------------------------

PLATFORM_HINTS = {
    "MEDICAL": (
        "For medical appointments, prefer Zocdoc (zocdoc.com) for doctors/specialists, "
        "1-800-Dentist or local dental websites for dentists, or direct phone calls "
        "to the patient's existing providers. Check insurance network first."
    ),
    "HOUSEHOLD": (
        "For household tasks, prefer TaskRabbit (taskrabbit.com) for handyperson work, "
        "Thumbtack (thumbtack.com) for contractors, Angi (angi.com) for larger projects, "
        "or Jiffy Lube / local shops for car maintenance."
    ),
    "CHILDCARE": (
        "For childcare tasks, prefer Care.com for sitters/nannies, Wyzant (wyzant.com) "
        "or Tutor.com for tutors, direct school/provider contact for appointments, "
        "or Google Search for local activity programs."
    ),
    "OTHER": (
        "For general tasks, use Google Search to find local providers, "
        "or draft an email/make a phone call as appropriate."
    ),
}

SYSTEM_PROMPT = """You are an expert personal scheduling assistant. Given a list of
classified tasks and a summary of the user's calendar availability, produce a
detailed action plan for each task.

For each task you must:
1. Assign a priority (HIGH / MEDIUM / LOW) based on health impact, urgency, and overdue signals.
2. Select up to 3 suggested time windows from the provided free slots that are realistic
   for the task type (e.g. medical appointments need 60-90 min, oil changes 30-60 min).
3. Recommend the best platform or booking method.
4. Write a concrete, actionable next step the user can follow immediately.
5. Estimate how long the appointment/task will take.

Platform guidance by category:
{platform_hints}

Return ONLY a valid JSON object — no markdown, no preamble — matching this schema:

{{
  "generated_at": "ISO datetime",
  "total_tasks": integer,
  "items": [
    {{
      "task_name": "string",
      "task_type": "MEDICAL|HOUSEHOLD|CHILDCARE|OTHER",
      "priority": "HIGH|MEDIUM|LOW",
      "priority_reason": "string",
      "suggested_time_windows": [
        {{
          "date": "YYYY-MM-DD",
          "start_time": "HH:MM",
          "end_time": "HH:MM",
          "reason": "string"
        }}
      ],
      "recommended_platform": "string",
      "platform_url": "string or null",
      "recommended_action": "string",
      "estimated_duration_minutes": integer,
      "notes": "string"
    }}
  ]
}}"""

HUMAN_TEMPLATE = """Here are the classified tasks:

{tasks_json}

Here is the user's calendar availability for the next {lookahead} days:

{availability_json}

Today's date is {today}.

Please generate the action plan for all {count} tasks."""


# ---------------------------------------------------------------------------
# Planner
# ---------------------------------------------------------------------------

class ActionPlanner:
    """
    Generates a full ActionPlan from classified tasks and calendar availability.

    Parameters
    ----------
    model : str
        Claude model ID. Defaults to claude-sonnet-4-6.
    temperature : float
        LLM temperature. Default 0.3 for some creative variety in suggestions.
    """

    def __init__(
        self,
        model: str = "claude-sonnet-4-6",
        temperature: float = 0.3,
    ):
        self.llm = ChatAnthropic(model=model, temperature=temperature)

    def generate(
        self,
        classified_tasks: list[ClassifiedTask],
        availability: list[dict],
        today: str,
        lookahead_days: int = 30,
    ) -> ActionPlan:
        """
        Generate an ActionPlan.

        Parameters
        ----------
        classified_tasks : list of ClassifiedTask from the classifier step.
        availability : list of day dicts from CalendarReader.summarize_availability().
        today : ISO date string for today.
        lookahead_days : number of days in the availability window.
        """
        platform_hints_str = "\n".join(
            f"  {k}: {v}" for k, v in PLATFORM_HINTS.items()
        )

        tasks_for_prompt = [
            {
                "task_name": t.task_name,
                "task_type": t.task_type,
                "confidence": t.confidence,
                "reasoning": t.reasoning,
            }
            for t in classified_tasks
        ]

        messages = [
            SystemMessage(
                content=SYSTEM_PROMPT.format(platform_hints=platform_hints_str)
            ),
            HumanMessage(
                content=HUMAN_TEMPLATE.format(
                    tasks_json=json.dumps(tasks_for_prompt, indent=2),
                    availability_json=json.dumps(availability, indent=2),
                    today=today,
                    lookahead=lookahead_days,
                    count=len(classified_tasks),
                )
            ),
        ]

        response = self.llm.invoke(messages)
        raw_content = response.content

        # Strip markdown fences if present
        clean = raw_content.strip()
        if clean.startswith("```"):
            lines = clean.split("\n")
            clean = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        parsed = json.loads(clean)
        return ActionPlan(**parsed)

    @staticmethod
    def plan_to_dict(plan: ActionPlan) -> dict:
        """Serialize an ActionPlan to a plain dict (JSON-serializable)."""
        return plan.model_dump()
