export type StratosSemanticSource =
  | "budget"
  | "projectflow"
  | "archflow"
  | "aiip";

export type StratosSemanticMetric =
  | "budget.plan_amount"
  | "budget.actual_amount"
  | "budget.forecast_amount"
  | "budget.commitments_amount"
  | "budget.variance_amount"
  | "project.status"
  | "project.schedule_status"
  | "milestone.max_delay_days"
  | "milestone.next_due_date"
  | "archflow.need.status"
  | "archflow.need.readiness_score"
  | "archflow.need.impact_score"
  | "archflow.need.decision"
  | "archflow.need.budget_handoff_status"
  | "aiip.idea.status"
  | "aiip.idea.value_score"
  | "aiip.idea.risk_score"
  | "aiip.idea.expected_benefit"
  | "aiip.idea.handoff_status";
