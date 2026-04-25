import { Context } from "hono"
import { checkoutAudioSpeechUsage } from "./shared/audio-usage-utils"

const buildProxyRequest = (
    request: Request,
    reqJson: any,
    config: ChannelConfig,
    deploymentName: string
): Request => {
    const url = new URL(request.url)
    const targetUrl = new URL(config.endpoint)

    if (!config.endpoint.endsWith('#')) {
        const basePath = targetUrl.pathname.endsWith('/')
            ? targetUrl.pathname.slice(0, -1)
            : targetUrl.pathname
        targetUrl.pathname = `${basePath}/openai/deployments/${deploymentName}/${url.pathname.replace('/v1/', '')}`
    }

    if (config.api_version) {
        targetUrl.searchParams.set('api-version', config.api_version)
    }

    const targetHeaders = new Headers(request.headers)
    targetHeaders.delete("Authorization")
    targetHeaders.delete("Host")
    targetHeaders.delete("Cookie")
    targetHeaders.set("api-key", config.api_key)

    return new Request(targetUrl, {
        method: request.method,
        headers: targetHeaders,
        body: JSON.stringify(reqJson),
    })
}

export default {
    async fetch(
        c: Context<HonoCustomType>,
        config: ChannelConfig,
        requestBody: any,
        saveUsage: (usage: Usage) => Promise<void>,
    ): Promise<Response> {
        const { model: deploymentName } = requestBody

        const proxyRequest = buildProxyRequest(c.req.raw, requestBody, config, deploymentName)
        const response = await fetch(proxyRequest)

        if (response.ok) {
            await checkoutAudioSpeechUsage(saveUsage, response, requestBody)
        }

        return response
    }
}
