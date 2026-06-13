import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { Button, ButtonLink, type ButtonVariant } from "@voldzi/stratos-ui";

import { withAppBasePath } from "@/lib/app-url";

type ButtonTone = "default" | "primary" | "danger";

function buttonVariant(tone: ButtonTone): ButtonVariant {
  if (tone === "primary") return "primary";
  if (tone === "danger") return "danger";
  return "default";
}

type StratosButtonProps = ComponentPropsWithoutRef<"button"> & {
  tone?: ButtonTone;
};

export function StratosButton({ children, tone = "default", ...props }: StratosButtonProps) {
  return <Button variant={buttonVariant(tone)} {...props}>{children}</Button>;
}

type StratosButtonLinkProps = ComponentPropsWithoutRef<typeof Link> & {
  tone?: ButtonTone;
};

export function StratosButtonLink({ children, tone = "default", href, ...props }: StratosButtonLinkProps) {
  return <ButtonLink variant={buttonVariant(tone)} href={withAppBasePath(String(href))} {...props}>{children}</ButtonLink>;
}

export function StratosIconButtonLink({ children, href, ...props }: ComponentPropsWithoutRef<typeof Link>) {
  return <ButtonLink iconOnly href={withAppBasePath(String(href))} {...props}>{children}</ButtonLink>;
}
