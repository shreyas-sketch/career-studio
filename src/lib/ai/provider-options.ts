import { AiProvider } from "@/generated/prisma/enums";

/** The provider cards in Settings → AI provider (SET-1), as in the prototype's `PROVIDERS`. */
export const PROVIDER_OPTIONS: readonly {
  value: AiProvider;
  name: string;
  /** Who receives the data, for the privacy notes; null when it's whoever runs the server. */
  vendor: string | null;
  description: string;
  tag: string;
  /** Runs on the user's own hardware: no notes about data leaving, and one AI job at a time. */
  local: boolean;
  /** Filled in when the card is picked; empty means "type your server's address". */
  defaultUrl: string;
  urlPlaceholder: string;
  /** Shown under the address. */
  urlHint?: string;
  defaultModel: string;
  /** The key field, if the card has one; `hint` says when it's needed. */
  apiKey: { label: string; hint?: string } | null;
  /** Career Studio: where to get a key, step by step, for the setup instructions. */
  setup?: { url: string; steps: string[] };
}[] = [
  {
    value: AiProvider.LOCAL,
    name: "Local model",
    vendor: null,
    description: "Runs on your own hardware through Ollama or llama.cpp.",
    tag: "Private · free · slower",
    local: true,
    defaultUrl: "http://localhost:11434",
    urlPlaceholder: "http://localhost:11434",
    urlHint:
      "Career Studio in Docker? There, localhost is Career Studio's own container: use http://host.docker.internal:11434 for Ollama on this computer, or http://ollama:11434 for the Compose service.",
    defaultModel: "",
    apiKey: null,
  },
  {
    value: AiProvider.LMSTUDIO,
    name: "LM Studio",
    vendor: null,
    description: "Models you run in LM Studio, on this computer or your network.",
    tag: "Private · free · your hardware",
    local: true,
    // Dossier runs in Docker, where localhost is its own container.
    defaultUrl: "http://host.docker.internal:1234",
    urlPlaceholder: "http://host.docker.internal:1234",
    urlHint:
      "That's LM Studio on the computer Career Studio's Docker runs on; without Docker, use http://localhost:1234. Can't connect? Start the server in LM Studio's Developer tab, and turn on Serve on Local Network there.",
    defaultModel: "",
    apiKey: { label: "API token", hint: "Only needed if you've turned on authentication in LM Studio's server settings." },
  },
  {
    value: AiProvider.OPENAI,
    name: "OpenAI-compatible",
    vendor: null,
    description: "OpenAI, or any service with OpenAI's API: OpenRouter, DeepSeek, Groq, Together and others.",
    tag: "Bring your own endpoint",
    local: false,
    defaultUrl: "https://api.openai.com/v1",
    urlPlaceholder: "https://api.openai.com/v1",
    urlHint: "OpenAI: https://api.openai.com/v1 · OpenRouter: https://openrouter.ai/api/v1 · DeepSeek: https://api.deepseek.com. It must be a public https address.",
    defaultModel: "",
    apiKey: { label: "API key" },
    setup: {
      url: "https://platform.openai.com/api-keys",
      steps: ["Sign in to your provider's dashboard (for OpenAI, platform.openai.com).", "Create an API key and add billing or credits there.", "Paste the key below, pick a model and test the connection."],
    },
  },
  {
    value: AiProvider.ANTHROPIC,
    name: "Anthropic",
    vendor: "Anthropic",
    description: "Claude models through your own API key.",
    tag: "Hosted · pay per use",
    local: false,
    defaultUrl: "https://api.anthropic.com",
    urlPlaceholder: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-5",
    apiKey: { label: "API key" },
    setup: {
      url: "https://console.anthropic.com/settings/keys",
      steps: ["Sign in at console.anthropic.com and add credits under Billing.", "Create a key under Settings → API keys.", "Paste it below, pick a model and test the connection."],
    },
  },
  {
    value: AiProvider.MISTRAL,
    name: "Mistral",
    vendor: "Mistral",
    description: "Mistral's models through your own API key.",
    tag: "Hosted · free tier to start",
    local: false,
    defaultUrl: "https://api.mistral.ai/v1",
    urlPlaceholder: "https://api.mistral.ai/v1",
    defaultModel: "mistral-medium-latest",
    apiKey: { label: "API key" },
    setup: {
      url: "https://console.mistral.ai/api-keys",
      steps: ["Sign in at console.mistral.ai and choose a plan (there's a free tier to start).", "Create a key under API keys.", "Paste it below, pick a model and test the connection."],
    },
  },
];

/**
 * The providers a hosted Career Studio offers: on-device ones can't be
 * reached from a server (src/lib/ai/index.ts refuses them too).
 */
export const HOSTED_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter((option) => !option.local);

export function providerOption(provider: AiProvider) {
  return PROVIDER_OPTIONS.find((option) => option.value === provider)!;
}

/** What people see when a saved key can't be decrypted, e.g. after DOSSIER_SECRET changed. */
export const API_KEY_UNREADABLE = "Your saved API key can't be read. Please enter it again.";

/** What Settings may know about the API key: never the key itself. */
export type KeyState = "none" | "set" | "unreadable" | "env";

/** What the AI provider section starts from. */
export type AiSettingsView = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  keyState: KeyState;
};
