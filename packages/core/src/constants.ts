/** Monotonic integer, bumped on parser bug fixes */
export const PARSER_REVISION = 1;

/** Canonical schema version */
export const SCHEMA_VERSION = 1;

/** Maximum chunk size in characters for message chunking */
export const MAX_CHUNK_SIZE = 2000;

/** API key prefix */
export const API_KEY_PREFIX = "pk_";

/** API key hex length (excluding prefix) */
export const API_KEY_HEX_LENGTH = 32;

/** Metadata batch size for upload */
export const METADATA_BATCH_SIZE = 50;

/** Login timeout in milliseconds */
export const LOGIN_TIMEOUT_MS = 120_000;

/** Config directory name */
export const CONFIG_DIR = "pika";

/** Config file name */
export const CONFIG_FILE = "config.json";

/** Dev config file name */
export const DEV_CONFIG_FILE = "config.dev.json";

/** Cursors file name */
export const CURSORS_FILE = "cursors.json";

/** Parse errors file name */
export const PARSE_ERRORS_FILE = "parse-errors.jsonl";

/** Maximum upload retries */
export const MAX_UPLOAD_RETRIES = 2;

/** Initial backoff in milliseconds */
export const INITIAL_BACKOFF_MS = 1000;

/** Content upload concurrency (number of sessions uploaded in parallel) */
export const CONTENT_UPLOAD_CONCURRENCY = 8;
