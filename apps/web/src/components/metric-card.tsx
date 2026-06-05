import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "default" | "success" | "attention" | "danger";
}

export function MetricCard({ label, value, detail, icon: Icon, tone = "default" }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2} />
      </div>
      <div>
        <p className="metric-card__label">{label}</p>
        <strong className="metric-card__value">{value}</strong>
        <p className="metric-card__detail">{detail}</p>
      </div>
    </article>
  );
}
