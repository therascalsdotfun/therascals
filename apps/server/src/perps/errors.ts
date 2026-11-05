import { UserError } from "../client-message.ts";
export class PerpsError extends UserError {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "PERPS_ERROR",
  ) {
    super(message);
    this.name = "PerpsError";
  }
}
