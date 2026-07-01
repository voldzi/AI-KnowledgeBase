export class AssistantReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantReportValidationError";
  }
}
