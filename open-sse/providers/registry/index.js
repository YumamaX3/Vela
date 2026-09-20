// Stream handler with disconnect detection - shared for all providers
import p0 from "./a6api.js";
import p1 from "./alicode.js";
import p2 from "./alicode-intl.js";
import p3 from "./alims-intl.js";
import p4 from "./alitp-intl.js";
import p5 from "./anthropic.js";
import p6 from "./antigravity.js";
import p7 from "./api-airforce.js";
import p8 from "./assemblyai.js";
import p9 from "./aws-polly.js";
import p10 from "./azure.js";
import p11 from "./baidu.js";
import p12 from "./bandelbanget.js";
import p13 from "./baseten.js";
import p14 from "./bazaarlink.js";
import p15 from "./black-forest-labs.js";
import p16 from "./blackbox.js";
import p17 from "./bluesminds.js";
import p18 from "./brave-search.js";
import p19 from "./byteplus.js";
import p20 from "./bytez.js";
import p21 from "./cartesia.js";
import p22 from "./cerebras.js";
import p23 from "./chutes.js";
import p24 from "./claude.js";
import p25 from "./cline.js";
import p26 from "./clinepass.js";
import p27 from "./cloudflare-ai.js";
import p28 from "./codebuddy-cn.js";
import p29 from "./codebuddy-intl.js";
import p30 from "./codecrafters.js";
import p31 from "./codestral.js";
import p32 from "./codex.js";
import p33 from "./cohere.js";
import p34 from "./comfyui.js";
import p35 from "./commandcode.js";
import p36 from "./coqui.js";
import p37 from "./cursor.js";
import p38 from "./deepgram.js";
import p39 from "./deepinfra.js";
import p40 from "./deepseek.js";
import p41 from "./edge-tts.js";
import p42 from "./elevenlabs.js";
import p43 from "./exa.js";
import p44 from "./fal-ai.js";
import p45 from "./featherless.js";
import p46 from "./firecrawl.js";
import p47 from "./fireworks.js";
import p48 from "./fish-audio.js";
import p49 from "./freebuff.js";
import p50 from "./friendliai.js";
import p51 from "./galadriel.js";
import p52 from "./gemini.js";
import p53 from "./gemini-cli.js";
import p54 from "./gigachat.js";
import p55 from "./github.js";
import p56 from "./gitlab.js";
import p57 from "./glm.js";
import p58 from "./glm-cn.js";
import p59 from "./google-pse.js";
import p60 from "./google-tts.js";
import p61 from "./grok-cli.js";
import p62 from "./grok-web.js";
import p63 from "./groq.js";
import p64 from "./heroku.js";
import p65 from "./huggingface.js";
import p66 from "./hyperbolic.js";
import p67 from "./iflow.js";
import p68 from "./inworld.js";
import p69 from "./jembatanai.js";
import p70 from "./jerouter.js";
import p71 from "./jina-ai.js";
import p72 from "./jina-reader.js";
import p73 from "./kilo-gateway.js";
import p74 from "./kilocode.js";
import p75 from "./kimchi.js";
import p76 from "./kimi.js";
import p77 from "./kiro.js";
import p78 from "./linkup.js";
import p79 from "./llamagate.js";
import p80 from "./llm7.js";
import p81 from "./local-device.js";
import p82 from "./madefaka.js";
import p83 from "./mimo-free.js";
import p84 from "./minimax.js";
import p85 from "./minimax-cn.js";
import p86 from "./mistral.js";
import p87 from "./mmf.js";
import p88 from "./morph.js";
import p89 from "./mytraceroute.js";
import p90 from "./nanobanana.js";
import p91 from "./nanogpt.js";
import p92 from "./nebius.js";
import p93 from "./nesarouter.js";
import p94 from "./nscale.js";
import p95 from "./nvidia.js";
import p96 from "./ollama.js";
import p97 from "./ollama-local.js";
import p98 from "./ollama-search.js";
import p99 from "./openai.js";
import p100 from "./opencode.js";
import p101 from "./opencode-go.js";
import p102 from "./openrouter.js";
import p103 from "./ovhcloud.js";
import p104 from "./perplexity.js";
import p105 from "./perplexity-agent.js";
import p106 from "./perplexity-web.js";
import p107 from "./playht.js";
// import p114 from "./devin-cli.js";
// import p104 from "./windsurf.js";
import p108 from "./poolside.js";
import p109 from "./predibase.js";
import p110 from "./publicai.js";
import p111 from "./qoder.js";
import p112 from "./qzz.js";
import p113 from "./recraft.js";
import p114 from "./runwayml.js";
import p115 from "./sambanova.js";
import p116 from "./sdwebui.js";
import p117 from "./searchapi.js";
import p118 from "./searxng.js";
import p119 from "./selfhosted-embedding.js";
import p120 from "./selfhosted-stt.js";
import p121 from "./selfhosted-tts.js";
import p122 from "./serper.js";
import p123 from "./siliconflow.js";
import p124 from "./stability-ai.js";
import p125 from "./tavily.js";
import p126 from "./tencent.js";
import p127 from "./together.js";
import p128 from "./tokenharbor.js";
import p129 from "./tokenrouter.js";
import p130 from "./topaz.js";
import p131 from "./tortoise.js";
import p132 from "./upstage.js";
import p133 from "./venice.js";
import p134 from "./vercel-ai-gateway.js";
import p135 from "./vertex.js";
import p136 from "./vertex-partner.js";
import p137 from "./volcengine.js";
import p138 from "./volcengine-ark.js";
import p139 from "./voyage-ai.js";
import p140 from "./wandb.js";
import p141 from "./weizerouter.js";
import p142 from "./xai.js";
import p143 from "./xiaomi-mimo.js";
import p144 from "./xiaomi-tokenplan.js";
import p145 from "./xquik.js";
import p146 from "./youcom.js";
// Temporarily hidden — no tool calling support (trae SOLO agent / windsurf gRPC skip ToolCallChunk).
// Re-enable by uncommenting both the import and the array entry below.
// import p102 from "./trae.js";
import p147 from "./zed.js";
import p148 from "./zenmux.js";

export default [
  p0,
  p1,
  p2,
  p3,
  p4,
  p5,
  p6,
  p7,
  p8,
  p9,
  p10,
  p11,
  p12,
  p13,
  p14,
  p15,
  p16,
  p17,
  p18,
  p19,
  p20,
  p21,
  p22,
  p23,
  p24,
  p25,
  p26,
  p27,
  p28,
  p29,
  p30,
  p31,
  p32,
  p33,
  p34,
  p35,
  p36,
  p37,
  p38,
  p39,
  p40,
  p41,
  p42,
  p43,
  p44,
  p45,
  p46,
  p47,
  p48,
  p49,
  p50,
  p51,
  p52,
  p53,
  p54,
  p55,
  p56,
  p57,
  p58,
  p59,
  p60,
  p61,
  p62,
  p63,
  p64,
  p65,
  p66,
  p67,
  p68,
  p69,
  p70,
  p71,
  p72,
  p73,
  p74,
  p75,
  p76,
  p77,
  p78,
  p79,
  p80,
  p81,
  p82,
  p83,
  p84,
  p85,
  p86,
  p87,
  p88,
  p89,
  p90,
  p91,
  p92,
  p93,
  p94,
  p95,
  p96,
  p97,
  p98,
  p99,
  p100,
  p101,
  p102,
  p103,
  p104,
  p105,
  p106,
  p107,
  // p114, // devin-cli — hidden, spawns local agent with shell/fs access
  // p104, // windsurf — hidden, no tool calling
  p108,
  p109,
  p110,
  p111,
  p112,
  p113,
  p114,
  p115,
  p116,
  p117,
  p118,
  p119,
  p120,
  p121,
  p122,
  p123,
  p124,
  p125,
  p126,
  p127,
  p128,
  p129,
  p130,
  p131,
  p132,
  p133,
  p134,
  p135,
  p136,
  p137,
  p138,
  p139,
  p140,
  p141,
  p142,
  p143,
  p144,
  p145,
  p146,
  // p102, // trae — hidden, no tool calling
  p147,
  p148,
];
