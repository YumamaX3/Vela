// Agent Skills metadata — single source of truth for /dashboard/skills page.
// Each skill = one raw GitHub URL the user copies and pastes to any AI agent.
// `id` doubles as the directory name under skills/ — the URL builders below
// derive every link from it, so ids and directories must always match.

const REPO = "YumamaX3/Vela";
const BRANCH = "main";
const SKILL_PATH = "skills";

export const SKILLS_REPO_URL = `https://github.com/${REPO}`;
export const SKILLS_RAW_BASE = `https://raw.githubusercontent.com/${REPO}/refs/heads/${BRANCH}/${SKILL_PATH}`;
export const SKILLS_BLOB_BASE = `https://github.com/${REPO}/blob/${BRANCH}/${SKILL_PATH}`;
export const SKILLS_TREE_BASE = `https://github.com/${REPO}/tree/${BRANCH}/${SKILL_PATH}`;

// Groups the fleet sails in (render order). The entry skill stands alone.
export const SKILL_GROUPS = [
  { id: "conversation", label: "Conversation & Knowledge", icon: "forum" },
  { id: "media", label: "Voice & Vision", icon: "graphic_eq" },
  { id: "web", label: "Web", icon: "language" },
];

export const SKILLS = [
  {
    id: "Vela",
    name: "Vela (Entry)",
    description: "Setup + index of all capabilities. Start here — covers base URL, auth, model discovery, and links to every capability skill.",
    endpoint: null,
    icon: "hub",
    group: "foundation",
    keywords: ["setup", "start", "entry", "config", "auth", "models"],
    isEntry: true,
  },
  {
    id: "Vela-chat",
    name: "Chat",
    description: "Chat / code-gen via OpenAI or Anthropic format with streaming.",
    endpoint: "/v1/chat/completions",
    icon: "chat",
    group: "conversation",
    keywords: ["llm", "code", "stream", "anthropic", "openai", "messages"],
  },
  {
    id: "Vela-image",
    name: "Image Generation",
    description: "Text-to-image via DALL-E, Imagen, FLUX, MiniMax, SDWebUI…",
    endpoint: "/v1/images/generations",
    icon: "image",
    group: "media",
    keywords: ["dall-e", "flux", "imagen", "text-to-image", "picture"],
  },
  {
    id: "Vela-video",
    name: "Video Generation",
    description: "Text-to-video via xAI Grok Imagine. Async job flow — submit, poll, download the MP4.",
    endpoint: "/v1/videos/generations",
    icon: "movie",
    group: "media",
    keywords: ["grok", "imagine", "txt2vid", "motion", "async", "mp4"],
  },
  {
    id: "Vela-tts",
    name: "Text-to-Speech",
    description: "OpenAI / ElevenLabs / Edge / Google / Deepgram voices.",
    endpoint: "/v1/audio/speech",
    icon: "record_voice_over",
    group: "media",
    keywords: ["voice", "audio", "speech", "elevenlabs", "speak"],
  },
  {
    id: "Vela-stt",
    name: "Speech-to-Text",
    description: "Transcribe audio via OpenAI Whisper, Groq, Gemini, Deepgram, AssemblyAI…",
    endpoint: "/v1/audio/transcriptions",
    icon: "mic",
    group: "media",
    keywords: ["transcribe", "whisper", "audio", "voice", "dictation"],
  },
  {
    id: "Vela-embeddings",
    name: "Embeddings",
    description: "Vectors for RAG / semantic search via OpenAI, Gemini, Mistral…",
    endpoint: "/v1/embeddings",
    icon: "scatter_plot",
    group: "conversation",
    keywords: ["vectors", "rag", "semantic", "search", "similarity"],
  },
  {
    id: "Vela-web-search",
    name: "Web Search",
    description: "Tavily / Exa / Brave / Serper / SearXNG / Google PSE / You.com.",
    endpoint: "/v1/search",
    icon: "search",
    group: "web",
    keywords: ["tavily", "brave", "serper", "query", "internet"],
  },
  {
    id: "Vela-web-fetch",
    name: "Web Fetch",
    description: "URL → markdown / text / HTML via Firecrawl, Jina, Tavily, Exa.",
    endpoint: "/v1/web/fetch",
    icon: "language",
    group: "web",
    keywords: ["url", "markdown", "scrape", "firecrawl", "jina", "crawl"],
  },
];

export function getSkillRawUrl(id) {
  return `${SKILLS_RAW_BASE}/${id}/SKILL.md`;
}

export function getSkillBlobUrl(id) {
  return `${SKILLS_BLOB_BASE}/${id}/SKILL.md`;
}
