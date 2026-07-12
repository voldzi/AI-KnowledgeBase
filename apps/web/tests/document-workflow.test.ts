import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  catalogEntry,
  directoryUsersToWorkflowSubjects,
  documentWorkflowRoles,
  initialWorkflowAssignments,
  validateDocumentWorkflowAssignments,
  workflowAssignmentsToDocumentAssignments,
} from "../src/lib/documents/document-workflow";

describe("document workflow", () => {
  it("keeps the default workflow limited to one gestor and one approver", () => {
    const roles = documentWorkflowRoles("cs");

    assert.deepEqual(roles.map((role) => role.id), ["gestor", "approver"]);
    assert.ok(roles.every((role) => role.required));
    assert.ok(roles.every((role) => role.minAssignments === 1));
    assert.ok(roles.every((role) => role.maxAssignments === 1));
  });

  it("maps people and directory groups without presenting technical ids as names", () => {
    const subjects = directoryUsersToWorkflowSubjects([
      {
        subject_id: "user-123",
        display_name: "Jana Nováková",
        email: "jana@example.test",
        username: "jnovak",
        enabled: true,
        groups: ["/Sekce IT/Architektura"],
      },
    ], "user-123", "cs");

    assert.equal(subjects.find((subject) => subject.id === "user-123")?.name, "Jana Nováková");
    assert.equal(subjects.find((subject) => subject.id === "/Sekce IT/Architektura")?.name, "Architektura");
    assert.equal(subjects.find((subject) => subject.id === "/Sekce IT/Architektura")?.type, "organization");
  });

  it("persists controlled participants as Registry assignments", () => {
    const subjects = directoryUsersToWorkflowSubjects([
      {
        subject_id: "gestor-1",
        display_name: "Gestor Dokumentu",
        email: null,
        enabled: true,
        groups: ["Schvalovatele"],
      },
      {
        subject_id: "approver-1",
        display_name: "Schvalovatel Dokumentu",
        email: null,
        enabled: true,
        groups: [],
      },
    ], "gestor-1", "cs");

    const assignments = workflowAssignmentsToDocumentAssignments([
      ...initialWorkflowAssignments("gestor-1"),
      { id: "approver-primary", roleId: "approver", subjectId: "approver-1", primary: true },
    ], subjects);

    assert.deepEqual(assignments.map((assignment) => assignment.role), ["gestor", "approver"]);
    assert.equal(assignments[0]?.display_label, "Gestor Dokumentu");
    assert.equal(assignments[1]?.display_label, "Schvalovatel Dokumentu");
    assert.equal(assignments[1]?.sla_days, 5);
  });

  it("requires the approver to be different from the gestor", () => {
    const errors = validateDocumentWorkflowAssignments([
      { id: "gestor-primary", roleId: "gestor", subjectId: "user-1", primary: true },
      { id: "approver-primary", roleId: "approver", subjectId: "user-1", primary: true },
    ], "cs");

    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.roleId, "approver");
    assert.match(errors[0]?.message ?? "", /odlišný/);
  });

  it("keeps document type defaults in one catalog", () => {
    const contract = catalogEntry("contract");

    assert.equal(contract.defaultClassification, "restricted");
    assert.equal(contract.chunkingStrategy, "semantic");
    assert.ok(contract.defaultTags.includes("smlouva"));
  });
});
