"""
classifier.py — Classify reminders into task types using LangChain + Claude.

Each reminder is classified into one of:
    MEDICAL    — doctor, dentist, therapy, prescription, health-related
    HOUSEHOLD  — repairs, maintenance, cleaning, contractors, home services
    CHILDCARE  — school, tutoring, pediatric, activities, child-related
    OTHER      — anything that doesn't fit the above categories

Uses a structured output chain with Pydantic for reliable JSON extraction.
"""

from __future__ import annotations

import json
from typing import Literal

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

TaskType = Literal["MEDICAL", "HOUSEHOLD", "CHILDCARE", "OTHER"]


class ClassifiedTask(BaseModel):
    task_name: str = Field(description="The original reminder name, unchanged.")
    task_type: TaskType = Field(
        description="Category: MEDICAL, HOUSEHOLD, CHILDCARE, or OTHER."
    )
    confidence: float = Field(
        ge=0.0, le=1.0,
        description="Classification confidence between 0 and 1."
    )
    reasoning: str = Field(
        description="One-sentence explanation of why this category was chosen."
    )


class ClassificationBatch(BaseModel):
    tasks: list[ClassifiedTask]


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a personal scheduling assistant. Your job is to classify
each reminder task into exactly one of these categories:

  MEDICAL   — anything involving health, doctors, dentists, therapists,
              hospitals, prescriptions, vision, or medical equipment.
  HOUSEHOLD — home repairs, maintenance, cleaning services, contractors,
              plumbers, electricians, appliance repair, landscaping,
              or vehicle maintenance (oil change, tires, etc.).
  CHILDCARE — school appointments, tutoring, pediatrician, daycare,
              extracurricular activities, or anything primarily for a child.
  OTHER     — tasks that don't clearly fit the above categories.

Return ONLY a valid JSON object matching this schema exactly — no markdown,
no explanation outside the JSON:

{
  "tasks": [
    {
      "task_name": "string",
      "task_type": "MEDICAL|HOUSEHOLD|CHILDCARE|OTHER",
      "confidence": 0.0-1.0,
      "reasoning": "string"
    }
  ]
}"""

HUMAN_TEMPLATE = """Please classify the following reminders:

{tasks_json}

Return the JSON classification for all {count} tasks."""


# ---------------------------------------------------------------------------
# Classifier
# ---------------------------------------------------------------------------

class TaskClassifier:
    """
    Classifies a list of reminder dicts using Claude via LangChain.

    Parameters
    ----------
    model : str
        Claude model ID. Defaults to claude-sonnet-4-6.
    temperature : float
        LLM temperature. Lower = more deterministic. Default 0.
    """

    def __init__(
        self,
        model: str = "claude-sonnet-4-6",
        temperature: float = 0.0,
    ):
        self.llm = ChatAnthropic(model=model, temperature=temperature)

    def classify(self, reminders: list[dict]) -> list[ClassifiedTask]:
        """
        Classify a list of reminder dicts.

        Each dict must have at minimum a "name" key.
        Notes are included when present to improve accuracy.

        Returns a list of ClassifiedTask in the same order as input.
        """
        if not reminders:
            return []

        # Build a compact JSON list for the prompt
        tasks_for_prompt = [
            {
                "name": r.get("name", ""),
                "notes": r.get("notes", "") or "",
            }
            for r in reminders
        ]

        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(
                content=HUMAN_TEMPLATE.format(
                    tasks_json=json.dumps(tasks_for_prompt, indent=2),
                    count=len(tasks_for_prompt),
                )
            ),
        ]

        response = self.llm.invoke(messages)
        raw_content = response.content

        # Parse JSON — strip any accidental markdown fences
        clean = raw_content.strip()
        if clean.startswith("```"):
            lines = clean.split("\n")
            # Drop first and last fence lines
            clean = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        parsed = json.loads(clean)
        batch = ClassificationBatch(**parsed)
        return batch.tasks

    def classify_single(self, reminder: dict) -> ClassifiedTask:
        """Convenience wrapper to classify one reminder."""
        results = self.classify([reminder])
        if not results:
            raise ValueError("Classifier returned no results.")
        return results[0]
