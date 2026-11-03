import "server-only";

import { AiProvider } from "@/generated/prisma/enums";

import { loadAiConfig, type AiConfig } from "./config";
import { AiError } from "./errors";
import { providerOption } from "./provider-options";
import type { AIProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { LocalProvider } from "./providers/local";
import { LmStudioProvider } from "./providers/lmstudio";
import { MistralProvider } from "./providers/mistral";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

export { AiError } from "./errors";

export const ON_DEVICE_REFUSED =
  "Ollama, llama.cpp and LM Studio run on your own computer, which this hosted server can't reach. Choose Anthropic, OpenAI (or another OpenAI-compatible service such as OpenRouter or DeepSeek) or Mistral in Settings → AI provider.";

/** Providers that run on the user's own hardware. */
export const isOnDeviceProvider = (provider: AiProvider) => provider === AiProvider.LOCAL || provider === AiProvider.LMSTUDIO;
export type { AIProvider, ChatMessage, CompletionRequest, JsonCompletionRequest } from "./provider";

/** A provider for `config`. A saved key that can't be read stops hosted providers with a clear message. */
export function createProvider(config: AiConfig): AIProvider {
  const { provider, baseUrl, model, apiKey, apiKeyProblem, timeoutMs } = config;
  if (apiKeyProblem && providerOption(provider).apiKey) throw AiError.config(apiKeyProblem);
  // Career Studio is hosted: models on the user's own computer can't be reached from it.
  if (isOnDeviceProvider(provider) && process.env.CAREER_STUDIO_ALLOW_PRIVATE_AI_URLS !== "1") {
    throw AiError.config(ON_DEVICE_REFUSED);
  }
  switch (provider) {
    case AiProvider.LOCAL:
      return new LocalProvider(baseUrl, model, timeoutMs);
    case AiProvider.OPENAI:
      return new OpenAICompatibleProvider("OPENAI", baseUrl, apiKey, model, timeoutMs);
    case AiProvider.ANTHROPIC:
      return new AnthropicProvider(baseUrl, apiKey, model, timeoutMs);
    case AiProvider.MISTRAL:
      return new MistralProvider(baseUrl, apiKey, model, timeoutMs);
    case AiProvider.LMSTUDIO:
      return new LmStudioProvider(baseUrl, apiKey, model, timeoutMs);
  }
}

/** The provider configured in Settings, or by the DOSSIER_AI_* variables. */
export async function getAiProvider(): Promise<AIProvider> {
  return createProvider(await loadAiConfig());
}
