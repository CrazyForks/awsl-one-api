import { Context } from "hono";

import { CONSTANTS } from "../constants";
import { getJsonObjectValue, getJsonSetting } from "../utils";

const isPositiveNumber = (value: unknown): value is number => {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// Token 工具对象
export const TokenUtils = {
    async updateUsage(c: Context<HonoCustomType>, key: string, usageAmount: number): Promise<boolean> {
        try {
            const tokenRow = await c.env.DB.prepare(
                `SELECT value FROM api_token WHERE key = ?`
            ).bind(key).first<Pick<ApiTokenRow, "value">>();
            const tokenData = tokenRow?.value
                ? getJsonObjectValue<ApiTokenData>(tokenRow.value)
                : null;
            if (!tokenData) {
                return false;
            }

            const updateUsageStatement = c.env.DB.prepare(
                `UPDATE api_token
                 SET usage = usage + ?,
                     updated_at = datetime('now')
                 WHERE key = ?`
            ).bind(usageAmount, key);

            const hasPeriodQuota = isPositiveNumber(tokenData.daily_quota)
                || isPositiveNumber(tokenData.monthly_quota);

            if (hasPeriodQuota) {
                const results = await c.env.DB.batch([
                    updateUsageStatement,
                    this.buildPeriodUsageStatement(c, key, 'day', usageAmount),
                    this.buildPeriodUsageStatement(c, key, 'month', usageAmount),
                ]);
                const totalResult = results[0];
                return totalResult.success && (totalResult.meta?.changes ?? 0) > 0;
            }

            const result = await updateUsageStatement.run();

            if (!result.success) {
                return false;
            }

            if ((result.meta?.changes ?? 0) === 0) {
                return false;
            }

            await this.updatePeriodUsage(c, key, 'day', usageAmount);
            await this.updatePeriodUsage(c, key, 'month', usageAmount);

            return true;
        } catch (error) {
            console.error('Error updating token usage:', error);
            return false;
        }
    },
    async updatePeriodUsage(
        c: Context<HonoCustomType>,
        key: string,
        periodType: 'day' | 'month',
        usageAmount: number
    ): Promise<boolean> {
        try {
            const result = await this.buildPeriodUsageStatement(c, key, periodType, usageAmount).run();
            return result.success;
        } catch (error) {
            console.warn(`Period usage update skipped for ${periodType}:`, error);
            return false;
        }
    },
    buildPeriodUsageStatement(
        c: Context<HonoCustomType>,
        key: string,
        periodType: 'day' | 'month',
        usageAmount: number
    ) {
        const periodKeyExpression = periodType === 'day'
            ? "date('now')"
            : "strftime('%Y-%m', 'now')";

        return c.env.DB.prepare(
            `INSERT INTO api_token_usage_period (token_key, period_type, period_key, usage)
             VALUES (?, ?, ${periodKeyExpression}, ?)
             ON CONFLICT(token_key, period_type, period_key) DO UPDATE SET
             usage = usage + ?,
             updated_at = datetime('now')`
        ).bind(key, periodType, usageAmount, usageAmount);
    },
    async getPricing(c: Context<HonoCustomType>, model: string, channelConfig: ChannelConfig): Promise<ModelPricing | null> {
        // Check channel-specific pricing first
        if (channelConfig?.model_pricing?.[model]) {
            return channelConfig.model_pricing[model];
        }

        // Fallback to global pricing
        const globalPricingMap = await getJsonSetting(c, CONSTANTS.MODEL_PRICING_KEY);
        return globalPricingMap?.[model] || null;
    },

    async processUsage(c: Context<HonoCustomType>, apiKey: string, model: string, targetChannelKey: string, targetChannelConfig: ChannelConfig, usage: Usage): Promise<void> {
        console.log("Usage data:", usage);

        const pricing = await this.getPricing(c, model, targetChannelConfig);
        const hasInputTokens = usage.prompt_tokens != null;
        const hasOutputTokens = usage.completion_tokens != null;
        const hasTokens = hasInputTokens || hasOutputTokens;
        const requestCost = pricing?.request || 0

        if (pricing && (hasTokens || requestCost > 0)) {
            const inputCost = hasInputTokens ? usage.prompt_tokens! * pricing.input : 0;
            const outputCost = hasOutputTokens ? usage.completion_tokens! * pricing.output : 0;
            const maskedApiKey = apiKey.length < 3 ? '*'.repeat(apiKey.length) : (
                apiKey.slice(0, apiKey.length / 3)
                + '*'.repeat(apiKey.length / 3)
                + apiKey.slice((2 * apiKey.length) / 3)
            );

            let cacheCost = 0;
            if (hasInputTokens && usage.cached_tokens && usage.cached_tokens > 0 && pricing.cache) {
                cacheCost = usage.cached_tokens * pricing.cache;
            }

            const totalCost = inputCost + outputCost + cacheCost + requestCost;

            const updated = await this.updateUsage(c, apiKey, totalCost);
            if (!updated) {
                console.warn(`Usage update ignored due to quota limit or conflict. Model: ${model}, Channel: ${targetChannelKey}, apiKey: ${maskedApiKey}, Cost: ${totalCost} (request: ${requestCost}, input: ${inputCost}, cache: ${cacheCost}, output: ${outputCost})`);
                return;
            }
            console.log(`Model: ${model}, Channel: ${targetChannelKey}, apiKey: ${maskedApiKey}, Cost: ${totalCost} (request: ${requestCost}, input: ${inputCost}, cache: ${cacheCost}, output: ${outputCost})`);
        } else {
            console.warn(`No pricing found for model: ${model} in channel: ${targetChannelKey}`);
        }
    },
};
