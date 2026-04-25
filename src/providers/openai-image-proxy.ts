import { Context } from "hono"
import { checkoutImageUsage } from "./shared/image-usage-utils"

const buildProxyRequest = (
    request: Request,
    reqJson: any,
    config: ChannelConfig
): Request => {
    const url = new URL(request.url)
    const targetUrl = new URL(config.endpoint)

    targetUrl.pathname = url.pathname

    const targetHeaders = new Headers(request.headers)
    targetHeaders.delete("Host")
    targetHeaders.delete("Cookie")
    targetHeaders.set("Authorization", `Bearer ${config.api_key}`)

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
        const proxyRequest = buildProxyRequest(c.req.raw, requestBody, config)
        const response = await fetch(proxyRequest)

        if (response.ok) {
            c.executionCtx.waitUntil(checkoutImageUsage(saveUsage, response.clone()))
        }

        return response
    }
}
