import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

import { withAppBasePath } from "@/lib/app-url";

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

function normalizeLinkHref(href: ComponentPropsWithoutRef<typeof Link>["href"]) {
  return typeof href === "string" ? withAppBasePath(href) : href;
}

export function StratosButtonLink({ className, tone = "default", href, ...props }: StratosButtonLinkProps) {
  return <Link className={buttonClassName(tone, className)} href={normalizeLinkHref(href)} {...props} />;
}

export function StratosIconButtonLink({ className, href, ...props }: ComponentPropsWithoutRef<typeof Link>) {
  return <Link className={["stratos-icon-button", className ?? ""].filter(Boolean).join(" ")} href={normalizeLinkHref(href)} {...props} />;
}
