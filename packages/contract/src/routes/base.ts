import { oc } from "@orpc/contract";

import { baseErrors } from "../errors";

// Every procedure starts from one of these. `authed` needs a session (cookie
// or bearer token, see the security schemes in `openapi.ts`); `open` doesn't,
// and says so in OpenAPI with an empty `security`.

export const authed = oc.errors(baseErrors);

export const open = oc
  .errors({
    NOT_FOUND: baseErrors.NOT_FOUND,
    RATE_LIMITED: baseErrors.RATE_LIMITED,
  })
  .$route({ spec: (operation) => ({ ...operation, security: [] }) });
