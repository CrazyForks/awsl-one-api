type ImageTokensDetails = {
    cached_tokens?: number;
    text_tokens?: number;
    image_tokens?: number;
}

type ImageUsage = {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens_details?: ImageTokensDetails;
    prompt_tokens_details?: ImageTokensDetails;
    output_tokens_details?: ImageTokensDetails;
}

type ImageResponse = {
    usage?: ImageUsage;
}

const normalizeImageUsage = (raw?: ImageUsage): Usage | null => {
    if (!raw) {
        return null
    }

    const inputDetails = raw.input_tokens_details ?? raw.prompt_tokens_details
    const cachedTokens =
        inputDetails?.cached_tokens ??
        0
    const inputDetailsTokens = (inputDetails?.text_tokens ?? 0) + (inputDetails?.image_tokens ?? 0)
    const outputDetailsTokens = (
        (raw.output_tokens_details?.text_tokens ?? 0) +
        (raw.output_tokens_details?.image_tokens ?? 0)
    )
    const rawInputTokens = raw.prompt_tokens ?? raw.input_tokens ?? (
        inputDetailsTokens > 0 ? inputDetailsTokens : undefined
    )
    const outputTokens = raw.completion_tokens ?? raw.output_tokens ?? (
        outputDetailsTokens > 0 ? outputDetailsTokens : undefined
    )
    const inputTokens = rawInputTokens == null
        ? undefined
        : Math.max(0, rawInputTokens - cachedTokens)
    const totalTokens = raw.total_tokens ?? (
        (inputTokens ?? 0) + cachedTokens + (outputTokens ?? 0)
    )

    if (inputTokens == null && outputTokens == null && totalTokens == null) {
        return null
    }

    return {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: totalTokens,
        cached_tokens: cachedTokens > 0 ? cachedTokens : undefined,
    }
}

export const checkoutImageUsage = async (
    saveUsage: (usage: Usage) => Promise<void>,
    response: Response,
): Promise<void> => {
    try {
        const contentType = response.headers.get("content-type") || ""
        if (!contentType.includes("application/json")) {
            return
        }

        const resJson = await response.clone().json<ImageResponse>()
        const usage = normalizeImageUsage(resJson.usage)
        if (!usage) {
            return
        }

        await saveUsage(usage)
    } catch (error) {
        console.error("Error logging image usage data:", error)
    }
}
