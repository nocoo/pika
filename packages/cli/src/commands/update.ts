/**
 * pika update — update CLI to latest version.
 *
 * Uses cli-base createUpdateCommand for standard update behavior.
 */

import { createUpdateCommand } from "@nocoo/cli-base";
import { PIKA_VERSION } from "@pika/core";

export default createUpdateCommand({
  packageName: "@nocoo/pika",
  currentVersion: PIKA_VERSION,
  cliName: "pika",
});
