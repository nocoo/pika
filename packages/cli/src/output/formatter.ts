// ─── Types ────────────────────────────────────────────────────

export type OutputFormat = "json" | "table" | "minimal" | "text" | "markdown";

export interface OutputOptions {
  format: OutputFormat;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export interface TableColumn<T> {
  key: keyof T | ((row: T) => string);
  header: string;
  width?: number;
  align?: "left" | "right";
}

export interface ResponseOptions<T> {
  columns: TableColumn<T>[];
  minimalKey: keyof T;
}

// ─── OutputFormatter ──────────────────────────────────────────

export class OutputFormatter {
  private readonly format: OutputFormat;
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;

  constructor(options: OutputOptions) {
    this.format = options.format;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
  }

  getFormat(): OutputFormat {
    return this.format;
  }

  // ─── Data Output (stdout) ───────────────────────────────────

  /**
   * Output a full API response envelope.
   * - json: Pretty-printed full envelope
   * - table: Renders items as table
   * - minimal: Extracts minimalKey from each item, one per line
   */
  response<T>(
    envelope: { items: T[]; raw: unknown },
    options: ResponseOptions<T>
  ): void {
    switch (this.format) {
      case "json":
        this.json(envelope.raw);
        break;
      case "table":
        this.table(envelope.items, options.columns);
        break;
      case "minimal":
        for (const item of envelope.items) {
          this.stdout.write(`${item[options.minimalKey]}\n`);
        }
        break;
      default:
        this.json(envelope.raw);
    }
  }

  /** Output a single item */
  item<T extends object>(item: T): void {
    switch (this.format) {
      case "json":
        this.json(item);
        break;
      case "table":
        this.keyValue(item);
        break;
      default:
        this.json(item);
    }
  }

  /** Output raw JSON to stdout */
  json(data: unknown): void {
    this.stdout.write(JSON.stringify(data, null, 2) + "\n");
  }

  /** Output key-value pairs for a single item */
  private keyValue<T extends object>(item: T): void {
    const maxKeyLen = Math.max(...Object.keys(item).map((k) => k.length));
    for (const [key, value] of Object.entries(item)) {
      const displayValue =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      this.stdout.write(`${key.padEnd(maxKeyLen)}  ${displayValue}\n`);
    }
  }

  /** Output items as table */
  table<T>(items: T[], columns: TableColumn<T>[]): void {
    if (items.length === 0) {
      this.info("No items found.");
      return;
    }

    // Calculate column widths
    const widths = columns.map((col) => {
      if (col.width) return col.width;
      const headerLen = col.header.length;
      const maxValueLen = Math.max(
        ...items.map((item) => this.getCellValue(item, col).length)
      );
      return Math.max(headerLen, maxValueLen);
    });

    // Header
    const headerRow = columns
      .map((col, i) => col.header.padEnd(widths[i]))
      .join("  ");
    this.stdout.write(headerRow + "\n");

    // Separator
    const separator = widths.map((w) => "─".repeat(w)).join("──");
    this.stdout.write(separator + "\n");

    // Rows
    for (const item of items) {
      const row = columns
        .map((col, i) => {
          const value = this.getCellValue(item, col);
          const truncated =
            value.length > widths[i]
              ? value.slice(0, widths[i] - 1) + "…"
              : value;
          return col.align === "right"
            ? truncated.padStart(widths[i])
            : truncated.padEnd(widths[i]);
        })
        .join("  ");
      this.stdout.write(row + "\n");
    }
  }

  private getCellValue<T>(item: T, col: TableColumn<T>): string {
    if (typeof col.key === "function") {
      return col.key(item);
    }
    const value = item[col.key];
    if (value === null || value === undefined) return "";
    return String(value);
  }

  // ─── Messages (stderr) ──────────────────────────────────────

  info(message: string): void {
    this.stderr.write(`ℹ ${message}\n`);
  }

  success(message: string): void {
    this.stderr.write(`✔ ${message}\n`);
  }

  error(message: string): void {
    this.stderr.write(`✖ ${message}\n`);
  }

  warn(message: string): void {
    this.stderr.write(`⚠ ${message}\n`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Determine output format based on TTY and explicit flag.
 */
export function resolveFormat(
  explicit: string | undefined,
  isTTY = process.stdout.isTTY
): Exclude<OutputFormat, "auto"> {
  if (explicit === "json" || explicit === "table" || explicit === "minimal") {
    return explicit;
  }
  if (explicit === "text" || explicit === "markdown") {
    return explicit;
  }
  return isTTY ? "table" : "json";
}

// ─── Error handling ───────────────────────────────────────────

/** Custom error for API failures — caught by withErrorHandling */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Wrap a command handler with standard error handling.
 * - Catches errors and formats them consistently
 * - Handles 401 with "please run login" message
 * - Sets process.exitCode on error (does not throw)
 */
export async function withErrorHandling(
  handler: () => Promise<void>,
  formatter: OutputFormatter
): Promise<void> {
  try {
    await handler();
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401) {
        formatter.error("Not authenticated. Please run: pika login");
      } else {
        formatter.error(err.message);
      }
    } else if (err instanceof Error) {
      formatter.error(err.message);
    } else {
      formatter.error("An unknown error occurred");
    }
    process.exitCode = 1;
  }
}
