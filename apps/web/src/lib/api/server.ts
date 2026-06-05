import "server-only";

import type { ApiRequestContext } from "@/lib/types";

import { createApiClients } from ".";
import { getAklConfig } from "./config";
import { createMockContext } from "./correlation";

export function getServerApiClients() {
  return createApiClients();
}

export function getServerRequestContext(): ApiRequestContext {
  const config = getAklConfig();

  return createMockContext({
    subjectId: process.env.AKL_WEB_DEV_SUBJECT ?? "user_dev",
    roles: (process.env.AKL_WEB_DEV_ROLES ?? "admin,document_manager,reader")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean),
    groups: (process.env.AKL_WEB_DEV_GROUPS ?? "")
      .split(",")
      .map((group) => group.trim())
      .filter(Boolean),
    accessToken: config.devAccessToken
  });
}
