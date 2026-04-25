const AUDIO_OUTPUT_TOKENS_PER_MINUTE = 1250
const TEXT_TOKENS_PER_CHAR = 0.25
const SPEECH_CHARS_PER_MINUTE = 750

const collectInputText = (input: unknown): string => {
    if (typeof input === "string") {
        return input
    }

    if (Array.isArray(input)) {
        return input
            .map((item) => collectInputText(item))
            .filter((text) => text.length > 0)
            .join(" ")
    }

    if (!input || typeof input !== "object") {
        return ""
    }

    if ("text" in input && typeof input.text === "string") {
        return input.text
    }

    if ("content" in input) {
        return collectInputText(input.content)
    }

    return ""
}

export const estimateAudioSpeechUsage = (requestBody: any): Usage | null => {
    const inputText = collectInputText(requestBody?.input).trim()
    if (!inputText) {
        return null
    }

    const characterCount = Array.from(inputText).length
    const promptTokens = Math.max(1, Math.ceil(characterCount * TEXT_TOKENS_PER_CHAR))
    const estimatedMinutes = Math.max(1 / 60, characterCount / SPEECH_CHARS_PER_MINUTE)
    const completionTokens = Math.max(1, Math.ceil(estimatedMinutes * AUDIO_OUTPUT_TOKENS_PER_MINUTE))

    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
    }
}

export const checkoutAudioSpeechUsage = async (
    saveUsage: (usage: Usage) => Promise<void>,
    response: Response,
    requestBody: any,
): Promise<void> => {
    try {
        const contentType = response.headers.get("content-type") || ""
        if (!contentType.startsWith("audio/")) {
            return
        }

        const estimatedUsage = estimateAudioSpeechUsage(requestBody)
        if (!estimatedUsage) {
            return
        }

        await saveUsage(estimatedUsage)
    } catch (error) {
        console.error("Error logging audio usage data:", error)
    }
}
