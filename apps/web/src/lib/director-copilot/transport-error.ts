export class DirectorCopilotTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly outcome: "unavailable" | "not_authorized",
    readonly status?: number,
  ) {
    super(message);
    this.name = "DirectorCopilotTransportError";
  }
}
