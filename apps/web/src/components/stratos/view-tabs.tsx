import type { LucideIcon } from "lucide-react";
import { ViewTabs } from "@voldzi/stratos-ui";

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
    <ViewTabs
      ariaLabel={ariaLabel}
      activeTabId={value}
      tabs={items.map((item) => {
        const Icon = item.icon;
        return {
          id: item.value,
          label: item.label,
          icon: Icon ? <Icon size={16} aria-hidden="true" /> : undefined
        };
      })}
      onTabChange={(nextValue) => onValueChange(nextValue as TValue)}
    />
  );
}
