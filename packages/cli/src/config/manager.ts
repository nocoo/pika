import { randomUUID } from "node:crypto";
import { ConfigManager as BaseConfigManager } from "@nocoo/cli-base";
import { CONFIG_FILE, DEV_CONFIG_FILE } from "@pika/core";

const PROD_API_URL = "https://pika.hexly.ai";
const DEV_API_URL = "https://pika.dev.hexly.ai";

export interface PikaConfig {
  token?: string;
  deviceId?: string;
}

/**
 * Pika-specific configuration manager.
 * Extends cli-base ConfigManager with pika-specific helpers.
 */
export class ConfigManager extends BaseConfigManager<PikaConfig> {
  private readonly isDev: boolean;

  constructor(configDir: string, isDev = false) {
    super(configDir, isDev, {
      prodFilename: CONFIG_FILE,
      devFilename: DEV_CONFIG_FILE,
    });
    this.isDev = isDev;
  }

  getToken(): string | undefined {
    return this.read().token;
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  getApiUrl(): string {
    return this.isDev ? DEV_API_URL : PROD_API_URL;
  }

  getDeviceId(): string {
    const config = this.read();
    if (config.deviceId) return config.deviceId;
    const deviceId = randomUUID();
    this.write({ deviceId });
    return deviceId;
  }
}
