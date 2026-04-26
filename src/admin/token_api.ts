import { Context } from "hono"
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';

import { CommonErrorResponse, CommonSuccessfulResponse } from "../model";

const tokenDataSchema = z.object({
    name: z.string().describe('Token name'),
    channel_keys: z.array(z.string()).describe('Channel keys to bind (empty array means access to all channels)'),
    total_quota: z.number().finite().nonnegative().describe('Total quota amount'),
    daily_quota: z.number().finite().nonnegative().optional().describe('Daily quota amount'),
    monthly_quota: z.number().finite().nonnegative().optional().describe('Monthly quota amount'),
});

// Token 列表 API
export class TokenListEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Get all tokens',
        responses: {
            ...CommonSuccessfulResponse(z.array(z.object({
                key: z.string(),
                value: z.string(),
                usage: z.number(),
                daily_usage: z.number().optional(),
                monthly_usage: z.number().optional(),
                created_at: z.string(),
                updated_at: z.string(),
            }))),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        let result;
        try {
            result = await c.env.DB.prepare(
                `SELECT t.*,
                        COALESCE(day_usage.usage, 0) AS daily_usage,
                        COALESCE(month_usage.usage, 0) AS monthly_usage
                 FROM api_token t
                 LEFT JOIN api_token_usage_period day_usage
                   ON day_usage.token_key = t.key
                  AND day_usage.period_type = 'day'
                  AND day_usage.period_key = date('now')
                 LEFT JOIN api_token_usage_period month_usage
                   ON month_usage.token_key = t.key
                  AND month_usage.period_type = 'month'
                  AND month_usage.period_key = strftime('%Y-%m', 'now')
                 ORDER BY t.created_at DESC`
            ).all<ApiTokenRow>();
        } catch (error) {
            console.warn('Period usage table unavailable, falling back to token list without period usage:', error);
            result = await c.env.DB.prepare(
                `SELECT * FROM api_token ORDER BY created_at DESC`
            ).all<ApiTokenRow>();
        }

        return {
            success: true,
            data: result.results
        } as CommonResponse;
    }
}

// Token 创建/更新 API (Upsert)
export class TokenUpsertEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Create or update a token',
        request: {
            params: z.object({
                key: z.string().describe('Token key'),
            }),
            body: {
                content: {
                    'application/json': {
                        schema: tokenDataSchema,
                    },
                },
            },
        },
        responses: {
            ...CommonSuccessfulResponse(z.boolean()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const parseResult = tokenDataSchema.safeParse(await c.req.json());
        if (!parseResult.success) {
            return c.text(parseResult.error.issues.map(issue => issue.message).join(', '), 400);
        }

        const body = parseResult.data as ApiTokenData;
        const { key } = c.req.param();
        const existingToken = await c.env.DB.prepare(
            `SELECT key FROM api_token WHERE key = ?`
        ).bind(key).first<Pick<ApiTokenRow, "key">>();

        // Validate channels exist using batch query (if channel_keys is not empty)
        if (body.channel_keys && body.channel_keys.length > 0) {
            const channelQuery = body.channel_keys.map(() => '?').join(',');
            const existingChannels = await c.env.DB.prepare(
                `SELECT key FROM channel_config WHERE key IN (${channelQuery})`
            ).bind(...body.channel_keys).all();

            if (!existingChannels.results || existingChannels.results.length !== body.channel_keys.length) {
                const existingKeys = existingChannels.results?.map((row: any) => row.key) || [];
                const missingKeys = body.channel_keys.filter(key => !existingKeys.includes(key));
                return c.text(`Channels not found: ${missingKeys.join(', ')}`, 400);
            }
        }

        // Upsert token directly using SQL with ON CONFLICT
        const upsertStatement = c.env.DB.prepare(
            `INSERT INTO api_token (key, value)
             VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = datetime('now')`
        ).bind(key, JSON.stringify(body));

        let result;
        if (existingToken) {
            result = await upsertStatement.run();
        } else {
            try {
                const results = await c.env.DB.batch([
                    c.env.DB.prepare(
                        `DELETE FROM api_token_usage_period WHERE token_key = ?`
                    ).bind(key),
                    upsertStatement,
                ]);
                result = results[1];
            } catch (error) {
                console.error('Error upserting token:', error);
                return c.text('Failed to upsert token', 500);
            }
        }

        if (!result.success) {
            return c.text('Failed to upsert token', 500);
        }

        return {
            success: true,
            data: true
        } as CommonResponse;
    }
}

// Token 重置额度 API
export class TokenResetUsageEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Reset token usage to zero',
        request: {
            params: z.object({
                key: z.string().describe('Token key'),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.boolean()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const { key } = c.req.param();

        try {
            const results = await c.env.DB.batch([
                c.env.DB.prepare(
                    `UPDATE api_token SET usage = 0, updated_at = datetime('now') WHERE key = ?`
                ).bind(key),
                c.env.DB.prepare(
                    `DELETE FROM api_token_usage_period WHERE token_key = ?`
                ).bind(key),
            ]);
            const result = results[0];

            if (!result.success) {
                return c.text('Failed to reset token usage', 500);
            }

            return {
                success: true,
                data: result.success
            } as CommonResponse;
        } catch (error) {
            console.error('Error resetting token usage:', error);
            return c.text('Failed to reset token usage', 500);
        }
    }
}

// Token 删除 API
export class TokenDeleteEndpoint extends OpenAPIRoute {
    schema = {
        tags: ['Admin API'],
        summary: 'Delete token',
        request: {
            params: z.object({
                key: z.string().describe('Token key'),
            }),
        },
        responses: {
            ...CommonSuccessfulResponse(z.boolean()),
            ...CommonErrorResponse,
        },
    };

    async handle(c: Context<HonoCustomType>) {
        const { key } = c.req.param();

        try {
            const results = await c.env.DB.batch([
                c.env.DB.prepare(
                    `DELETE FROM api_token WHERE key = ?`
                ).bind(key),
                c.env.DB.prepare(
                    `DELETE FROM api_token_usage_period WHERE token_key = ?`
                ).bind(key),
            ]);
            const result = results[0];

            if (!result.success) {
                return c.text('Failed to delete token', 500);
            }

            return {
                success: true,
                data: result.success
            } as CommonResponse;
        } catch (error) {
            console.error('Error deleting token:', error);
            return c.text('Failed to delete token', 500);
        }
    }
}
