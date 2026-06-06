import type { LucideIcon } from "lucide-react";

export interface StratosViewTab<TValue extends string> {
  value: TValue;
  label: string;
  icon?: LucideIcon;
}

interface StratosViewTabsProps<TValue extends string> {
  ariaLabel: string;
  items: Array<StratosViewTab<TValue>>;
  value: TValue;
  onValueChange: (value: TValue) => void;
}

export function StratosViewTabs<TValue extends string>({
  ariaLabel,
  items,
  onValueChange,
  value
}: StratosViewTabsProps<TValue>) {
  return (
    <nav className="stratos-view-tabs" aria-label={ariaLabel}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={`stratos-view-tabs__button ${value === item.value ? "stratos-view-tabs__button--active" : ""}`}
            key={item.value}
            type="button"
            onClick={() => onValueChange(item.value)}
          >
            {Icon ? <Icon size={16} aria-hidden="true" /> : null}
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
