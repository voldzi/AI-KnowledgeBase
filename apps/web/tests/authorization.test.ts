import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canUseAdminSurface,
  canUseEmployeeChat,
  canUseKnowledgeWorkspace,
  isEmployeeChatOnly,
  surfaceForContext
} from "../src/lib/auth/authorization";

describe("AKB web authorization", () => {
  it("keeps standard readers in the employee chat portal", () => {
    const context = { roles: ["reader"] };

    assert.equal(canUseEmployeeChat(context), true);
    assert.equal(canUseKnowledgeWorkspace(context), false);
    assert.equal(canUseAdminSurface(context), false);
    assert.equal(isEmployeeChatOnly(context), true);
    assert.equal(surfaceForContext(context), "employee_chat");
  });

  it("allows knowledge roles to use the workspace", () => {
    for (const role of ["document_manager", "reviewer", "auditor", "document_owner"]) {
      const context = { roles: [role] };
      assert.equal(canUseKnowledgeWorkspace(context), true);
      assert.equal(isEmployeeChatOnly(context), false);
      assert.equal(surfaceForContext(context), "knowledge_workspace");
    }
  });

  it("keeps admin as the only admin surface role", () => {
    assert.equal(canUseAdminSurface({ roles: ["admin"] }), true);
    assert.equal(canUseAdminSurface({ roles: ["document_manager"] }), false);
    assert.equal(surfaceForContext({ roles: ["admin", "reader"] }), "admin");
  });
});
