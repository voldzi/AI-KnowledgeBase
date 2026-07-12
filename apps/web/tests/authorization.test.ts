import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canUseAdminSurface,
  canAccessWorkspaceRoute,
  canUseEmployeeChat,
  canUseIntelligence,
  canUseKnowledgeWorkspace,
  isEmployeeChatOnly,
  surfaceForContext
} from "../src/lib/auth/authorization";
import {
  applyRolePreviewToContext,
  createRolePreview,
  openRolePreview,
  sealRolePreview
} from "../src/lib/auth/role-preview";

describe("AKB web authorization", () => {
  it("keeps standard readers in the employee chat portal", () => {
    const context = { subjectId: "user_reader", roles: ["reader"] };

    assert.equal(canUseEmployeeChat(context), true);
    assert.equal(canUseKnowledgeWorkspace(context), false);
    assert.equal(canUseAdminSurface(context), false);
    assert.equal(isEmployeeChatOnly(context), true);
    assert.equal(surfaceForContext(context), "employee_chat");
  });

  it("allows any authenticated user to enter the employee chat shell", () => {
    const context = { subjectId: "user_authenticated", roles: [] };

    assert.equal(canUseEmployeeChat(context), true);
    assert.equal(canUseKnowledgeWorkspace(context), false);
    assert.equal(canUseAdminSurface(context), false);
    assert.equal(isEmployeeChatOnly(context), true);
    assert.equal(surfaceForContext(context), "employee_chat");
  });

  it("does not let STRATOS global roles substitute for AKB capabilities", () => {
    const user = { subjectId: "user_stratos", roles: ["stratos_user"], capabilities: [] };
    const admin = { subjectId: "admin_stratos", roles: ["stratos_admin"], capabilities: [] };

    assert.equal(canUseEmployeeChat(user), false);
    assert.equal(canUseAdminSurface(admin), false);
    assert.equal(canAccessWorkspaceRoute(admin.roles, "/admin", admin.capabilities), false);
    assert.equal(canUseEmployeeChat({ ...user, capabilities: ["akb:access", "akb:chat"] }), true);
    assert.equal(canUseAdminSurface({ ...admin, capabilities: ["akb:manage_access"] }), true);
  });

  it("denies inactive identity, membership, and application access", () => {
    const context = {
      subjectId: "user_inactive",
      roles: ["stratos_user"],
      capabilities: ["akb:chat"]
    };

    assert.equal(canUseEmployeeChat({ ...context, identityActive: false }), false);
    assert.equal(canUseEmployeeChat({ ...context, membershipActive: false }), false);
    assert.equal(canUseEmployeeChat({ ...context, applicationAccessActive: false }), false);
  });

  it("allows knowledge roles to use the workspace", () => {
    for (const role of ["document_manager", "reviewer", "auditor", "document_owner", "document_gestor", "analyst"]) {
      const context = { subjectId: `user_${role}`, roles: [role] };
      assert.equal(canUseKnowledgeWorkspace(context), true);
      assert.equal(isEmployeeChatOnly(context), false);
      assert.equal(surfaceForContext(context), "knowledge_workspace");
    }
  });

  it("accepts STRATOS AKL-prefixed role aliases", () => {
    for (const role of [
      "akl_document_manager",
      "akl_reviewer",
      "akl_auditor",
      "akl_document_owner",
      "akl_document_gestor",
      "akl_analyst"
    ]) {
      const context = { subjectId: `user_${role}`, roles: [role] };
      assert.equal(canUseKnowledgeWorkspace(context), true);
      assert.equal(isEmployeeChatOnly(context), false);
      assert.equal(surfaceForContext(context), "knowledge_workspace");
    }

    assert.equal(isEmployeeChatOnly({ roles: ["akl_reader"] }), true);
  });

  it("keeps administration limited to admin-equivalent roles", () => {
    for (const role of [
      "admin",
      "akl_admin",
      "akb_admin",
      "stratos_superadmin"
    ]) {
      assert.equal(canUseAdminSurface({ roles: [role] }), true);
      assert.equal(surfaceForContext({ roles: [role, "reader"] }), "admin");
    }
    assert.equal(canUseAdminSurface({ roles: ["document_manager"] }), false);
  });

  it("exposes navigation and quick actions only to relevant roles", () => {
    assert.equal(canAccessWorkspaceRoute(["reader"], "/chat"), true);
    assert.equal(canAccessWorkspaceRoute(["reader"], "/documents"), false);
    assert.equal(canAccessWorkspaceRoute(["reviewer"], "/tasks"), true);
    assert.equal(canAccessWorkspaceRoute(["reviewer"], "/upload"), false);
    assert.equal(canAccessWorkspaceRoute(["analyst"], "/intelligence"), true);
    assert.equal(canUseIntelligence({ roles: ["analyst"] }), true);
    assert.equal(canUseIntelligence({ roles: ["document_owner"] }), false);
    assert.equal(canAccessWorkspaceRoute(["analyst"], "/audit"), false);
    assert.equal(canAccessWorkspaceRoute(["auditor"], "/audit"), true);
    assert.equal(canAccessWorkspaceRoute(["document_manager"], "/documents/new"), true);
    assert.equal(canAccessWorkspaceRoute(["document_owner"], "/documents/new"), false);
    assert.equal(canAccessWorkspaceRoute(["admin"], "/admin"), true);
  });

  it("allows signed role preview only for the current admin user", () => {
    const config = {
      environment: "test" as const,
      apiClientMode: "mock" as const,
      authMode: "mock" as const,
      serviceBaseUrls: {
        registry: "mock://registry",
        ingestion: "mock://ingestion",
        rag: "mock://rag",
        governance: "mock://governance",
        evaluation: "mock://evaluation"
      },
      devAccessToken: "test-role-preview-secret"
    };
    const preview = createRolePreview("employee", "admin-user", 1_000);
    assert.ok(preview);

    const sealed = sealRolePreview(preview, config);
    const opened = openRolePreview(sealed, config, 2_000);
    const adminPreview = applyRolePreviewToContext({ subjectId: "admin-user", roles: ["admin", "reader"] }, opened);
    const nonAdminPreview = applyRolePreviewToContext({ subjectId: "admin-user", roles: ["reader"] }, opened);
    const otherUserPreview = applyRolePreviewToContext({ subjectId: "other-admin", roles: ["admin"] }, opened);

    assert.deepEqual(adminPreview.context.roles, ["reader", "stratos_user", "akb_user"]);
    assert.equal(adminPreview.preview?.profileId, "employee");
    assert.deepEqual(nonAdminPreview.context.roles, ["reader"]);
    assert.equal(nonAdminPreview.preview, null);
    assert.deepEqual(otherUserPreview.context.roles, ["admin"]);
    assert.equal(otherUserPreview.preview, null);
    assert.equal(openRolePreview(`${sealed}tampered`, config, 2_000), null);
  });
});
