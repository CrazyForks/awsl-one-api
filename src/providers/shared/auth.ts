import { Context } from "hono"
import { getJsonObjectValue } from "../../utils"

const isPositiveNumber = (value: unknown): value is number => {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export const getApiKeyFromHeaders = (c: Context<HonoCustomType>): string | null => {
    const authHeader = c.req.raw.headers.get('Authorization');
    const xApiKey = c.req.raw.headers.get('x-api-key');

    if (authHeader) {
        return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    }
    if (xApiKey) {
        return xApiKey.trim();
    }
    return null;
}

export const fetchTokenData = async (c: Context<HonoCustomType>, apiKey: string) => {
    const tokenResult = await c.env.DB.prepare(
        `SELECT * FROM api_token WHERE key = ?`
    ).bind(apiKey).first();

    if (!tokenResult || !tokenResult.value) {
        return null;
    }
    const tokenData = getJsonObjectValue<ApiTokenData>(tokenResult.value);
    if (!tokenData) {
        return null;
    }

    let dailyUsage = 0;
    let monthlyUsage = 0;
    let periodUsageAvailable = true;

    try {
        const periodResult = await c.env.DB.prepare(
            `SELECT period_type, usage
             FROM api_token_usage_period
             WHERE token_key = ?
               AND (
                 (period_type = 'day' AND period_key = date('now'))
                 OR (period_type = 'month' AND period_key = strftime('%Y-%m', 'now'))
               )`
        ).bind(apiKey).all<{ period_type: string; usage: number }>();

        for (const row of periodResult.results || []) {
            if (row.period_type === 'day') {
                dailyUsage = row.usage || 0;
            }
            if (row.period_type === 'month') {
                monthlyUsage = row.usage || 0;
            }
        }
    } catch (error) {
        periodUsageAvailable = false;
        console.warn('Period usage table unavailable:', error);
    }

    return {
        tokenData: tokenData,
        usage: tokenResult.usage as number || 0,
        dailyUsage,
        monthlyUsage,
        periodUsageAvailable: periodUsageAvailable
            || (!isPositiveNumber(tokenData.daily_quota) && !isPositiveNumber(tokenData.monthly_quota)),
    };
}

export const fetchChannelsForToken = async (
    c: Context<HonoCustomType>,
    tokenData: ApiTokenData
) => {
    const channelKeys = tokenData.channel_keys;

    if (!channelKeys || channelKeys.length === 0) {
        return await c.env.DB.prepare(
            `SELECT key, value FROM channel_config`
        ).all<ChannelConfigRow>();
    }

    const channelQuery = channelKeys.map(() => '?').join(',');
    return await c.env.DB.prepare(
        `SELECT key, value FROM channel_config WHERE key IN (${channelQuery})`
    ).bind(...channelKeys).all<ChannelConfigRow>();
}

export const fetchAllChannels = async (c: Context<HonoCustomType>) => {
    return await c.env.DB.prepare(
        `SELECT key, value FROM channel_config`
    ).all<ChannelConfigRow>();
}
