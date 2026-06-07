import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

type ButtonTone = "default" | "primary" | "danger";

function buttonClassName(tone: ButtonTone, className?: string) {
  return ["stratos-button", tone !== "default" ? `stratos-button--${tone}` : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
}

type StratosButtonProps = ComponentPropsWithoutRef<"button"> & {
  tone?: ButtonTone;
};

export function StratosButton({ className, tone = "default", ...props }: StratosButtonProps) {
  return <button className={buttonClassName(tone, className)} {...props} />;
}

type StratosButtonLinkProps = ComponentPropsWithoutRef<typeof Link> & {
  tone?: ButtonTone;
};

export function StratosButtonLink({ className, tone = "default", ...props }: StratosButtonLinkProps) {
  return <Link className={buttonClassName(tone, className)} {...props} />;
}

export function StratosIconButtonLink({ className, ...props }: ComponentPropsWithoutRef<typeof Link>) {
  return <Link className={["stratos-icon-button", className ?? ""].filter(Boolean).join(" ")} {...props} />;
}
