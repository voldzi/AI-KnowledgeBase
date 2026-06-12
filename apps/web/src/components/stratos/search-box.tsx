import { SearchBox } from "@voldzi/stratos-ui";
import type { ChangeEvent, ComponentPropsWithoutRef } from "react";

type StratosSearchBoxProps = Omit<ComponentPropsWithoutRef<"input">, "size" | "type"> & {
  label: string;
};

export function StratosSearchBox({ className, id, label, onChange, value, ...props }: StratosSearchBoxProps) {
  return (
    <SearchBox
      id={id}
      className={className}
      ariaLabel={label}
      value={typeof value === "string" ? value : ""}
      onChange={(nextValue) => {
        onChange?.({
          currentTarget: { value: nextValue },
          target: { value: nextValue }
        } as ChangeEvent<HTMLInputElement>);
      }}
      {...props}
    />
  );
}
