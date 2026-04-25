import { Context } from "hono"
import { checkoutImageUsage } from "./shared/image-usage-utils"

const buildProxyRequest = (
    request: Request,
    reqJson: any,
    config: ChannelConfig,
    deploymentName: string
): Request => {
    const url = new URL(request.url)
    const targetUrl = new URL(config.endpoint)
    const useDeploymentPath = !config.endpoint.endsWith('#')

    if (useDeploymentPath) {
        const basePath = targetUrl.pathname.endsWith('/')
            ? targetUrl.pathname.slice(0, -1)
            : targetUrl.pathname
        targetUrl.pathname = `${basePath}/openai/deployments/${deploymentName}/${url.pathname.replace('/v1/', '')}`
    }

    if (config.api_version) {
        targetUrl.searchParams.set('api-version', config.api_version)
    }

    const proxyBody = { ...reqJson }
    if (useDeploymentPath) {
        delete proxyBody.model
    }

    const targetHeaders = new Headers(request.headers)
    targetHeaders.delete("Authorization")
    targetHeaders.delete("Host")
    targetHeaders.delete("Cookie")
    targetHeaders.set("api-key", config.api_key)

    return new Request(targetUrl, {
        method: request.method,
        headers: targetHeaders,
        body: JSON.stringify(proxyBody),
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
            await checkoutImageUsage(saveUsage, response)
        }

        return response
    }
}
