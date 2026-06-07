import { Search } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

type StratosSearchBoxProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  label: string;
};

export function StratosSearchBox({ className, id, label, ...props }: StratosSearchBoxProps) {
  return (
    <label className={["stratos-search-box", className ?? ""].filter(Boolean).join(" ")} htmlFor={id}>
      <Search size={17} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input id={id} type="search" {...props} />
    </label>
  );
}
