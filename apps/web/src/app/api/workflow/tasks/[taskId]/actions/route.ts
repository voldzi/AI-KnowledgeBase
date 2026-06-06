import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import type { ApplyWorkflowTaskActionRequest, RegistryWorkflowTaskAction } from "@/lib/types";

import { workflowBadRequest, workflowBridgeError } from "../../../errors";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    taskId: string;
  }>;
}

const allowedActions = new Set<RegistryWorkflowTaskAction>([
  "assign",
  "request_changes",
  "approve",
  "publish",
  "archive",
  "resolve"
]);

export async function POST(request: NextRequest, context: RouteContext) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return workflowBadRequest("Request body must be valid JSON.");
  }

  if (!isWorkflowTaskActionRequest(payload)) {
    return workflowBadRequest("Request body must contain a valid workflow task action.");
  }

  try {
    const { taskId } = await context.params;
    const requestContext = getServerRequestContext();
    const clients = getServerApiClients();
    const task = await clients.registry.applyWorkflowTaskAction(taskId, payload, requestContext);

    return NextResponse.json({ task });
  } catch (error) {
    return workflowBridgeError(error);
  }
}

function isWorkflowTaskActionRequest(value: unknown): value is ApplyWorkflowTaskActionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ApplyWorkflowTaskActionRequest>;
  if (typeof candidate.action !== "string" || !allowedActions.has(candidate.action as RegistryWorkflowTaskAction)) {
    return false;
  }
  if (candidate.comment !== undefined && candidate.comment !== null && typeof candidate.comment !== "string") {
    return false;
  }
  if (candidate.assignee_id !== undefined && candidate.assignee_id !== null && typeof candidate.assignee_id !== "string") {
    return false;
  }
  if (
    candidate.metadata !== undefined &&
    (typeof candidate.metadata !== "object" || candidate.metadata === null || Array.isArray(candidate.metadata))
  ) {
    return false;
  }
  return true;
}
