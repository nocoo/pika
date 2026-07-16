/**
 * pika update — update CLI to latest version.
 *
 * Uses base-cli createUpdateCommand for standard update behavior.
 */

import { createUpdateCommand } from "@nocoo/base-cli";
import { PIKA_VERSION } from "@pika/core";

export default createUpdateCommand({
  packageName: "@nocoo/pika",
  currentVersion: PIKA_VERSION,
  cliName: "pika",
});
