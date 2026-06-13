import type { LucideIcon } from "lucide-react";
import { MetricCard as StratosMetricCard, type MetricCardTone } from "@voldzi/stratos-ui";

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "default" | "success" | "attention" | "danger";
}

const toneMap: Record<NonNullable<MetricCardProps["tone"]>, MetricCardTone> = {
  default: "neutral",
  success: "good",
  attention: "warning",
  danger: "danger"
};

export function MetricCard({ label, value, detail, icon: Icon, tone = "default" }: MetricCardProps) {
  return (
    <StratosMetricCard
      icon={Icon}
      label={label}
      value={value}
      detail={detail}
      tone={toneMap[tone]}
      variant="command"
      interactive={false}
    />
  );
}
