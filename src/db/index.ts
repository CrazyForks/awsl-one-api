import { Context } from "hono";
import { CONSTANTS } from "../constants";
import { getJsonObjectValue, getSetting, saveSetting } from "../utils";

const DB_INIT_QUERIES = `
CREATE TABLE IF NOT EXISTS channel_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS api_token (
    key TEXT PRIMARY KEY,
    value TEXT,
    usage REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS api_token_usage_period (
    token_key TEXT NOT NULL,
    period_type TEXT NOT NULL,
    period_key TEXT NOT NULL,
    usage REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_key, period_type, period_key)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const CREATE_TOKEN_USAGE_PERIOD_TABLE_QUERY = "CREATE TABLE IF NOT EXISTS api_token_usage_period (token_key TEXT NOT NULL, period_type TEXT NOT NULL, period_key TEXT NOT NULL, usage REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (token_key, period_type, period_key));";

const REQUIRED_TABLES = [
    "channel_config",
    "api_token",
    "api_token_usage_period",
    "settings",
];

const countRows = async (c: Context<HonoCustomType>, tableName: string): Promise<number | null> => {
    try {
        const row = await c.env.DB.prepare(
            `SELECT COUNT(*) AS count FROM ${tableName}`
        ).first<{ count: number }>();
        return row?.count ?? 0;
    } catch {
        return null;
    }
}

const dbOperations = {
    initialize: async (c: Context<HonoCustomType>) => {
        // remove all \r and \n characters from the query string
        // split by ; and join with a ;\n
        const query = DB_INIT_QUERIES.replace(/[\r\n]/g, "")
            .split(";")
            .map((query) => query.trim())
            .join(";\n");
        await c.env.DB.exec(query);

        const version = await getSetting(c, CONSTANTS.DB_VERSION_KEY);
        if (version) {
            return c.json({ message: "Database already initialized" });
        }
        await saveSetting(c, CONSTANTS.DB_VERSION_KEY, CONSTANTS.DB_VERSION);
    },
    migrate: async (c: Context<HonoCustomType>) => {
        const version = await getSetting(c, CONSTANTS.DB_VERSION_KEY);
        if (version === CONSTANTS.DB_VERSION) {
            return;
        }

        await c.env.DB.exec(CREATE_TOKEN_USAGE_PERIOD_TABLE_QUERY);

        if (version !== "v0.0.2") {
            const channels = await c.env.DB.prepare(
                "SELECT key, value FROM channel_config"
            ).all<Pick<ChannelConfigRow, "key" | "value">>();

            for (const row of channels.results || []) {
                const config = getJsonObjectValue<ChannelConfig>(row.value);

                if (!config) {
                    continue;
                }

                config.supported_models = Object.keys(config.deployment_mapper || {});

                await c.env.DB.prepare(
                    `UPDATE channel_config
                     SET value = ?, updated_at = datetime('now')
                     WHERE key = ?`
                ).bind(JSON.stringify(config), row.key).run();
            }
        }

        // Update the version in the settings table
        await saveSetting(c, CONSTANTS.DB_VERSION_KEY, CONSTANTS.DB_VERSION);
    },
    getVersion: async (c: Context<HonoCustomType>): Promise<string | null> => {
        return await getSetting(c, CONSTANTS.DB_VERSION_KEY);
    },
    getStatus: async (c: Context<HonoCustomType>) => {
        const version = await getSetting(c, CONSTANTS.DB_VERSION_KEY);
        const tableRows = await c.env.DB.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table'`
        ).all<{ name: string }>();
        const existingTables = new Set((tableRows.results || []).map((row) => row.name));
        const tables = REQUIRED_TABLES.map((name) => ({
            name,
            exists: existingTables.has(name),
        }));

        const counts = {
            channels: await countRows(c, "channel_config"),
            tokens: await countRows(c, "api_token"),
            periodUsageRows: await countRows(c, "api_token_usage_period"),
            settings: await countRows(c, "settings"),
        };

        return {
            version,
            expectedVersion: CONSTANTS.DB_VERSION,
            isCurrent: version === CONSTANTS.DB_VERSION,
            tables,
            counts,
        };
    }
}

export default dbOperations;
