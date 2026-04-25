import { Context } from "hono"
import { getApiKeyFromHeaders, fetchTokenData, fetchChannelsForToken } from "./auth"
import { RouteId, getRoutePolicy } from "./route-policy"
import {
    findDeploymentMapping,
    findSupportedModel,
    getSupportedModels,
    getJsonObjectValue,
} from "../../utils"
import { TokenUtils } from "../../admin/token_utils"

export type ChannelResolution = {
    candidates: Array<{
        channel: { key: string; config: ChannelConfig }
        requestBody: Record<string, any>
        saveUsage: (usage: Usage) => Promise<void>
    }>
}

const shuffle = <T>(items: Array<T>): Array<T> => {
    const cloned = [...items];
    for (let i = cloned.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = cloned[i];
        cloned[i] = cloned[j];
        cloned[j] = temp;
    }
    return cloned;
}

const cloneRequestBody = (requestBody: Record<string, any>) => {
    return structuredClone
        ? structuredClone(requestBody)
        : JSON.parse(JSON.stringify(requestBody));
}

export const resolveChannel = async (
    c: Context<HonoCustomType>,
    routeId: RouteId
): Promise<ChannelResolution | Response> => {
    const apiKey = getApiKeyFromHeaders(c);
    if (!apiKey) {
        return c.text("Authorization header or x-api-key not found", 401);
    }

    const tokenInfo = await fetchTokenData(c, apiKey);
    if (!tokenInfo) {
        return c.text("Invalid API key", 401);
    }

    const { tokenData, usage } = tokenInfo;

    if (usage >= tokenData.total_quota) {
        return c.text("Quota exceeded", 402);
    }

    const channelsResult = await fetchChannelsForToken(c, tokenData);

    if (!channelsResult.results || channelsResult.results.length === 0) {
        return c.text("No available channels for this token", 401);
    }

    let requestBody: Record<string, any>;
    try {
        requestBody = await c.req.json();
    } catch (error) {
        return c.text("Invalid JSON body", 400);
    }

    const model = requestBody.model;
    if (!model) {
        return c.text("Model is required", 400);
    }

    const policy = getRoutePolicy(routeId);
    const allowedTypes = policy?.allowedTypes;

    const candidates: ChannelResolution["candidates"] = [];

    for (const row of channelsResult.results) {
        const config = getJsonObjectValue<ChannelConfig>(row.value);
        if (!config) {
            console.error(`Invalid channel config for key: ${row.key}`);
            continue;
        }

        if (allowedTypes && (!config.type || !allowedTypes.includes(config.type))) {
            continue;
        }

        const supportedPattern = findSupportedModel(getSupportedModels(config), model)
        if (!supportedPattern) {
            continue;
        }

        const mapping = findDeploymentMapping(config.deployment_mapper, model) || {
            pattern: supportedPattern,
            deployment: model,
        };

        const candidateRequestBody = cloneRequestBody(requestBody)
        candidateRequestBody.model = mapping.deployment;

        candidates.push({
            channel: {
                key: row.key,
                config: config,
            },
            requestBody: candidateRequestBody,
            saveUsage: async (usage: Usage) => {
                try {
                    await TokenUtils.processUsage(c, apiKey, candidateRequestBody.model, row.key, config, usage);
                } catch (error) {
                    console.error('Error processing usage:', error);
                }
            },
        });
    }

    if (candidates.length === 0) {
        return c.text(`Model not supported: ${model}. Please configure supported_models or deployment_mapper.`, 400);
    }

    return {
        candidates: shuffle(candidates),
    };
}
