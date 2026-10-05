export interface Config {
  port: number;
  host: string;
  dbPath: string;
  /** Rooms are deleted this many days after their last edit. */
  roomTtlDays: number;
  /** How often the expiry job runs. */
  expiryIntervalMs: number;
  /** Allowed browser origins for the HTTP API: comma-separated list or "*". */
  corsOrigin: string;
  maxClientsPerRoom: number;
  /** Room creations allowed per client IP per hour. */
  maxRoomsPerIpPerHour: number;
  /** Largest single WebSocket message accepted, in bytes. */
  maxMessageBytes: number;
  /** Debounce before a changed room document is written to SQLite. */
  saveDebounceMs: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: num("PORT", 1234),
    host: process.env.HOST ?? "0.0.0.0",
    dbPath: process.env.DB_PATH ?? "./data/seatplan.sqlite",
    roomTtlDays: num("ROOM_TTL_DAYS", 30),
    expiryIntervalMs: num("EXPIRY_INTERVAL_MS", 60 * 60 * 1000),
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    maxClientsPerRoom: num("MAX_CLIENTS_PER_ROOM", 50),
    maxRoomsPerIpPerHour: num("MAX_ROOMS_PER_IP_PER_HOUR", 30),
    maxMessageBytes: num("MAX_MESSAGE_BYTES", 2 * 1024 * 1024),
    saveDebounceMs: num("SAVE_DEBOUNCE_MS", 2000),
    ...overrides,
  };
}
