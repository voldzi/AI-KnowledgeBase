"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type ReactElement
} from "react";

type StratosSelectProps = ComponentPropsWithoutRef<"select"> & {
  clearDescription?: string;
  clearLabel?: string;
  closeLabel?: string;
  filterTitlePrefix?: string;
  label: string;
  noResultsLabel?: string;
  onValuesChange?: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
};

type ParsedOption = {
  disabled: boolean;
  label: string;
  value: string;
};

type OptionElement = ReactElement<ComponentPropsWithoutRef<"option">>;

function optionText(children: ComponentPropsWithoutRef<"option">["children"]) {
  return Children.toArray(children).join("");
}

function parseOptions(children: StratosSelectProps["children"]) {
  return Children.toArray(children)
    .filter(isValidElement)
    .filter((element): element is OptionElement => element.type === "option")
    .map((element) => {
      const value = String(element.props.value ?? optionText(element.props.children));
      return {
        disabled: Boolean(element.props.disabled),
        label: element.props.label ?? optionText(element.props.children) ?? value,
        value
      };
    });
}

export function StratosSelect({
  children,
  className,
  clearDescription = "Clear filter",
  clearLabel,
  closeLabel = "Close filter",
  defaultValue,
  disabled,
  filterTitlePrefix = "Filter",
  id,
  label,
  name,
  noResultsLabel = "No results",
  onChange,
  onValuesChange,
  placeholder,
  searchPlaceholder,
  value,
  ...props
}: StratosSelectProps) {
  const fallbackId = useId();
  const controlId = id ?? `stratos-select-${fallbackId}`;
  const popoverId = `${controlId}-popover`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => parseOptions(children), [children]);
  const multiple = Boolean(props.multiple);
  const initialValue = multiple
    ? Array.isArray(value)
      ? value.map(String)
      : Array.isArray(defaultValue)
        ? defaultValue.map(String)
        : []
    : String(value ?? defaultValue ?? options.find((option) => !option.disabled)?.value ?? "");
  const [internalValue, setInternalValue] = useState<string | string[]>(initialValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const currentValue = multiple
    ? Array.isArray(value)
      ? value.map(String)
      : Array.isArray(internalValue)
        ? internalValue
        : []
    : String(value ?? internalValue);
  const selectedValues = Array.isArray(currentValue) ? currentValue : [currentValue];
  const selectedOption = options.find((option) => option.value === currentValue) ?? options[0];
  const selectedLabel = multiple
    ? selectedValues.length
      ? options
          .filter((option) => selectedValues.includes(option.value))
          .map((option) => option.label)
          .join(", ")
      : placeholder ?? ""
    : selectedOption?.label ?? "";
  const resolvedClearLabel = clearLabel ?? placeholder ?? "All";
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  function selectOption(option: ParsedOption) {
    if (option.disabled || disabled) {
      return;
    }
    if (multiple) {
      const nextValues = selectedValues.includes(option.value)
        ? selectedValues.filter((selectedValue) => selectedValue !== option.value)
        : [...selectedValues, option.value];
      if (value === undefined) {
        setInternalValue(nextValues);
      }
      onValuesChange?.(nextValues);
      onChange?.({
        target: { id: controlId, name, value: nextValues.join(",") },
        currentTarget: { id: controlId, name, value: nextValues.join(",") }
      } as unknown as ChangeEvent<HTMLSelectElement>);
      return;
    }
    if (value === undefined) {
      setInternalValue(option.value);
    }
    onChange?.({
      target: { id: controlId, name, value: option.value },
      currentTarget: { id: controlId, name, value: option.value }
    } as unknown as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    setQuery("");
  }

  function clearSelection() {
    if (value === undefined) {
      setInternalValue(multiple ? [] : "");
    }
    onValuesChange?.([]);
    onChange?.({
      target: { id: controlId, name, value: "" },
      currentTarget: { id: controlId, name, value: "" }
    } as unknown as ChangeEvent<HTMLSelectElement>);
    if (!multiple) {
      setOpen(false);
    }
    setQuery("");
  }

  return (
    <div className={["stratos-field stratos-unified-select-field", className ?? ""].filter(Boolean).join(" ")} ref={wrapperRef}>
      <span>{label}</span>
      <select
        aria-hidden="true"
        className="stratos-select-native"
        disabled={disabled}
        id={`${controlId}-native`}
        name={name}
        tabIndex={-1}
        value={currentValue}
        onChange={onChange ?? (() => undefined)}
        {...props}
      >
        {children}
      </select>
      <button
        aria-controls={popoverId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="stratos-unified-select-trigger"
        disabled={disabled}
        id={controlId}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="stratos-unified-select-popover" id={popoverId}>
          <header className="stratos-unified-select-popover-header">
            <h3>{filterTitlePrefix}: {label}</h3>
            <button type="button" aria-label={closeLabel} onClick={() => setOpen(false)}>
              <X size={17} aria-hidden="true" />
            </button>
          </header>
          <label className="stratos-select-search">
            <Search size={15} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              placeholder={searchPlaceholder ?? label}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="stratos-select-options" role="listbox" aria-labelledby={controlId}>
            {multiple ? (
              <button
                className={selectedValues.length === 0 ? "is-selected is-clear-option" : "is-clear-option"}
                role="option"
                type="button"
                aria-selected={selectedValues.length === 0}
                onClick={clearSelection}
              >
                <span className="stratos-select-mark">
                  <X size={15} aria-hidden="true" />
                </span>
                <span>
                  <strong>{resolvedClearLabel}</strong>
                  <small>{clearDescription}</small>
                </span>
                {selectedValues.length === 0 ? <Check size={15} aria-hidden="true" /> : null}
              </button>
            ) : null}
            {filteredOptions.length ? (
              filteredOptions.map((option) => {
                const selected = selectedValues.includes(option.value);
                return (
                  <button
                    className={selected ? "is-selected" : ""}
                    disabled={option.disabled}
                    key={option.value}
                    role="option"
                    type="button"
                    aria-selected={selected}
                    onClick={() => selectOption(option)}
                  >
                    <span className="stratos-select-mark" aria-hidden="true" />
                    <span>
                      <strong>{option.label}</strong>
                      {multiple ? <small>{label}</small> : null}
                    </span>
                    {selected ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                );
              })
            ) : (
              <p className="stratos-empty-state">{noResultsLabel}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const StratosUnifiedSelect = StratosSelect;
