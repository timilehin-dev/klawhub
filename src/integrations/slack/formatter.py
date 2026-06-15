from typing import List, Dict, Any, Optional

class SlackFormatter:
    @staticmethod
    def build_section(text: str) -> Dict[str, Any]:
        return {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": text
            }
        }

    @staticmethod
    def build_divider() -> Dict[str, Any]:
        return {"type": "divider"}

    @staticmethod
    def build_context(elements: List[str]) -> Dict[str, Any]:
        return {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": e} for e in elements]
        }

    @staticmethod
    def build_progress_card(title: str, milestones: List[Dict[str, Any]], status_text: str) -> List[Dict[str, Any]]:
        """Builds an editable agentic progress card with milestone checklists."""
        blocks = [
            SlackFormatter.build_section(f"⏳ *{title}*"),
            SlackFormatter.build_divider()
        ]
        
        milestone_text = []
        for m in milestones:
            check = "✅" if m.get("status") == "completed" else "🏃" if m.get("status") == "running" else "⬜"
            milestone_text.append(f"{check} {m.get('name')}")
            
        blocks.append(SlackFormatter.build_section("\n".join(milestone_text)))
        blocks.append(SlackFormatter.build_divider())
        blocks.append(SlackFormatter.build_context([f"Status: {status_text}"]))
        return blocks

    @staticmethod
    def build_approval_card(action_id: str, title: str, description: str, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Builds a interactive card with Approve/Reject buttons for high-risk actions."""
        return [
            SlackFormatter.build_section(f"🚨 *Approval Required: {title}*"),
            SlackFormatter.build_section(description),
            SlackFormatter.build_divider(),
            {
                "type": "actions",
                "block_id": f"approval:{action_id}",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Approve ✅"},
                        "style": "primary",
                        "action_id": "approve"
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Reject ❌"},
                        "style": "danger",
                        "action_id": "reject"
                    }
                ]
            }
        ]

    @staticmethod
    def build_status_card(metrics: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Builds a system metrics summary card."""
        lines = [
            f"📡 *KlawHub System Status*",
            f"• **Active Skills:** {metrics.get('active_skills', 0)}",
            f"• **Monthly Runs:** {metrics.get('runs_this_month', 0)} / {metrics.get('monthly_limit', 100)}",
            f"• **Avg Latency:** {metrics.get('latency_ms', 0)}ms",
            f"• **Environment:** `{metrics.get('environment', 'prod')}`"
        ]
        return [
            SlackFormatter.build_section("\n".join(lines)),
            SlackFormatter.build_divider()
        ]
