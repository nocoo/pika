import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG_FILE, DEV_CONFIG_FILE } from "@pika/core";

const PROD_API_URL = "https://pika.nocoo.dev";
const DEV_API_URL = "http://localhost:7040";

export interface PikaConfig {
  token?: string;
  deviceId?: string;
}

export class ConfigManager {
  readonly configDir: string;
  private readonly isDev: boolean;

  constructor(configDir: string, isDev = false) {
    this.configDir = configDir;
    this.isDev = isDev;
  }

  private get configPath(): string {
    const fileName = this.isDev ? DEV_CONFIG_FILE : CONFIG_FILE;
    return join(this.configDir, fileName);
  }

  read(): PikaConfig {
    try {
      const content = readFileSync(this.configPath, "utf-8");
      return JSON.parse(content) as PikaConfig;
    } catch {
      return {};
    }
  }

  write(partial: Partial<PikaConfig>): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    const existing = this.read();
    const merged = { ...existing, ...partial };
    writeFileSync(this.configPath, JSON.stringify(merged, null, 2) + "\n");
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
