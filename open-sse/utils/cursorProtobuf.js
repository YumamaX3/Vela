/**
 * Cursor Protobuf Encoder/Decoder
 * Implements ConnectRPC protobuf wire format for Cursor API
 */

import { v4 as uuidv4 } from "uuid";
import zlib from "zlib";

const DEBUG = process.env.CURSOR_PROTOBUF_DEBUG === "1";
const log = (tag, ...args) => DEBUG && console.log(`[PROTOBUF:${tag}]`, ...args);
const textDecoder = new TextDecoder();

const PROTOBUF_SCHEMA_VERSION = "1.1.3";

// ==================== SCHEMAS ====================

const WIRE_TYPE = { VARINT: 0, FIXED64: 1, LEN: 2, FIXED32: 5 };

const ROLE = { USER: 1, ASSISTANT: 2 };

const UNIFIED_MODE = { CHAT: 1, AGENT: 2 };

const THINKING_LEVEL = { UNSPECIFIED: 0, MEDIUM: 1, HIGH: 2 };
const CLIENT_SIDE_TOOL_V2 = { MCP: 19 };
const CLIENT_SIDE_TOOL_V2_MCP = 19;

const FIELD = {
  // StreamUnifiedChatRequestWithTools (top level)
  REQUEST: 1,

  // StreamUnifiedChatRequest
  MESSAGES: 1,
  UNKNOWN_2: 2,
  INSTRUCTION: 3,
  UNKNOWN_4: 4,
  MODEL: 5,
  WEB_TOOL: 8,
  UNKNOWN_13: 13,
  CURSOR_SETTING: 15,
  UNKNOWN_19: 19,
  CONVERSATION_ID: 23,
  METADATA: 26,
  IS_AGENTIC: 27,
  SUPPORTED_TOOLS: 29,
  MESSAGE_IDS: 30,
  MCP_TOOLS: 34,
  LARGE_CONTEXT: 35,
  UNKNOWN_38: 38,
  UNIFIED_MODE: 46,
  UNKNOWN_47: 47,
  SHOULD_DISABLE_TOOLS: 48,
  THINKING_LEVEL: 49,
  UNKNOWN_51: 51,
  UNKNOWN_53: 53,
  UNIFIED_MODE_NAME: 54,

  // ConversationMessage
  MSG_CONTENT: 1,
  MSG_ROLE: 2,
  MSG_ID: 13,
  MSG_TOOL_RESULTS: 18,
  MSG_IS_AGENTIC: 29,
  MSG_SERVER_BUBBLE_ID: 32,
  MSG_UNIFIED_MODE: 47,
  MSG_SUPPORTED_TOOLS: 51,

  // ConversationMessage.ToolResult
  TOOL_RESULT_CALL_ID: 1,
  TOOL_RESULT_NAME: 2,
  TOOL_RESULT_INDEX: 3,
  TOOL_RESULT_RAW_ARGS: 5,
  TOOL_RESULT_RESULT: 8,
  TOOL_RESULT_TOOL_CALL: 11,
  TOOL_RESULT_MODEL_CALL_ID: 12,

  // ClientSideToolV2Result (nested inside ToolResult.result)
  CLIENT_RESULT_TOOL: 1,
  CLIENT_RESULT_MCP_RESULT: 28,
  CLIENT_RESULT_TOOL_CALL_ID: 35,
  CLIENT_RESULT_MODEL_CALL_ID: 48,
  CLIENT_RESULT_TOOL_INDEX: 49,
  // Aliases used by encodeClientSideToolV2Result
  CV2R_TOOL: 1,
  CV2R_MCP_RESULT: 28,
  CV2R_CALL_ID: 35,
  CV2R_MODEL_CALL_ID: 48,
  CV2R_TOOL_INDEX: 49,

  // MCPResult (nested inside ClientSideToolV2Result.mcp_result)
  MCP_RESULT_SELECTED_TOOL: 1,
  MCP_RESULT_RESULT: 2,
  // Aliases used by encodeMcpResult
  MCPR_SELECTED_TOOL: 1,
  MCPR_RESULT: 2,

  // ClientSideToolV2Call (nested inside ToolResult.tool_call)
  CLIENT_CALL_TOOL: 1,
  CLIENT_CALL_MCP_PARAMS: 27,
  CLIENT_CALL_TOOL_CALL_ID: 3,
  CLIENT_CALL_NAME: 9,
  CLIENT_CALL_RAW_ARGS: 10,
  CLIENT_CALL_TOOL_INDEX: 48,
  CLIENT_CALL_MODEL_CALL_ID: 49,
  // Aliases used by encodeClientSideToolV2Call
  CV2C_TOOL: 1,
  CV2C_MCP_PARAMS: 27,
  CV2C_CALL_ID: 3,
  CV2C_NAME: 9,
  CV2C_RAW_ARGS: 10,
  CV2C_TOOL_INDEX: 48,
  CV2C_MODEL_CALL_ID: 49,

  // Model
  MODEL_NAME: 1,
  MODEL_EMPTY: 4,

  // Instruction
  INSTRUCTION_TEXT: 1,

  // CursorSetting
  SETTING_PATH: 1,
  SETTING_UNKNOWN_3: 3,
  SETTING_UNKNOWN_6: 6,
  SETTING_UNKNOWN_8: 8,
  SETTING_UNKNOWN_9: 9,

  // CursorSetting.Unknown6
  SETTING6_FIELD_1: 1,
  SETTING6_FIELD_2: 2,

  // Metadata
  META_PLATFORM: 1,
  META_ARCH: 2,
  META_VERSION: 3,
  META_CWD: 4,
  META_TIMESTAMP: 5,

  // MessageId
  MSGID_ID: 1,
  MSGID_SUMMARY: 2,
  MSGID_ROLE: 3,

  // MCPTool
  MCP_TOOL_NAME: 1,
  MCP_TOOL_DESC: 2,
  MCP_TOOL_PARAMS: 3,
  MCP_TOOL_SERVER: 4,

  // StreamUnifiedChatResponseWithTools (response)
  TOOL_CALL: 1,
  RESPONSE: 2,

  // ClientSideToolV2Call
  TOOL_ID: 3,
  TOOL_NAME: 9,
  TOOL_RAW_ARGS: 10,
  TOOL_IS_LAST: 11,
  TOOL_IS_LAST_ALT: 15,
  TOOL_MCP_PARAMS: 27,

  // MCPParams
  MCP_TOOLS_LIST: 1,

  // MCPParams.Tool (nested)
  MCP_NESTED_NAME: 1,
  MCP_NESTED_PARAMS: 3,

  // StreamUnifiedChatResponse
  RESPONSE_TEXT: 1,
  THINKING: 25,

  // Thinking
  THINKING_TEXT: 1
};

// Known response field numbers — used to detect unknown fields from protocol updates
const KNOWN_RESPONSE_FIELDS = new Set([
  FIELD.TOOL_CALL,
  FIELD.RESPONSE,
  FIELD.TOOL_ID,
  FIELD.TOOL_NAME,
  FIELD.TOOL_RAW_ARGS,
  FIELD.TOOL_IS_LAST,
  FIELD.TOOL_MCP_PARAMS,
  FIELD.RESPONSE_TEXT,
  FIELD.THINKING
]);

// ==================== PRIMITIVE ENCODING ====================

export function encodeVarint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7F);
  return new Uint8Array(bytes);
}

export function encodeField(fieldNum, wireType, value) {
  const tag = (fieldNum << 3) | wireType;
  const tagBytes = encodeVarint(tag);

  if (wireType === WIRE_TYPE.VARINT) {
    const valueBytes = encodeVarint(value);
    return concatArrays(tagBytes, valueBytes);
  }

  if (wireType === WIRE_TYPE.LEN) {
    const dataBytes = typeof value === "string" 
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array ? value
      : Buffer.isBuffer(value) ? new Uint8Array(value)
      : new Uint8Array(0);
    
    const lengthBytes = encodeVarint(dataBytes.length);
    return concatArrays(tagBytes, lengthBytes, dataBytes);
  }

  return new Uint8Array(0);
}

function concatArrays(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ==================== MESSAGE ENCODING ====================

/**
 * Format tool name: "toolName" → "mcp_custom_toolName"
 * Also handles: "mcp__server__tool" → "mcp_server_tool"
 */
function formatToolName(name) {
  const base = typeof name === "string" && name.length > 0 ? name : "tool";

  if (base.startsWith("mcp__")) {
    const rest = base.slice("mcp__".length);
    const splitIdx = rest.indexOf("__");
    if (splitIdx >= 0) {
      const server = rest.slice(0, splitIdx) || "custom";
      const toolName = rest.slice(splitIdx + 2) || "tool";
      return `mcp_${server}_${toolName}`;
    }
    return `mcp_custom_${rest || "tool"}`;
  }

  if (base.startsWith("mcp_")) return base;
  return `mcp_custom_${base}`;
}

/**
 * Parse formatted tool name: "mcp_server_tool" → { serverName, selectedTool }
 */
function parseToolName(formattedName) {
  if (typeof formattedName !== "string" || !formattedName.startsWith("mcp_")) {
    return { serverName: "custom", selectedTool: formattedName || "tool" };
  }

  const tail = formattedName.slice("mcp_".length);
  const splitIdx = tail.indexOf("_");
  if (splitIdx < 0) {
    return { serverName: "custom", selectedTool: tail || "tool" };
  }

  return {
    serverName: tail.slice(0, splitIdx) || "custom",
    selectedTool: tail.slice(splitIdx + 1) || "tool"
  };
}

/**
 * Parse tool_call_id into { toolCallId, modelCallId }
 * Cursor uses "\nmc_" delimiter for model_call_id
 */
function parseToolId(id) {
  const delimiter = "\nmc_";
  const idx = id.indexOf(delimiter);
  if (idx >= 0) {
    return { toolCallId: id.slice(0, idx), modelCallId: id.slice(idx + delimiter.length) };
  }
  return { toolCallId: id, modelCallId: null };
}

/**
 * Encode MCPResult proto: { selected_tool, result }
 */
function encodeMcpResult(selectedTool, resultContent) {
  return concatArrays(
    encodeField(FIELD.MCPR_SELECTED_TOOL, WIRE_TYPE.LEN, selectedTool),
    encodeField(FIELD.MCPR_RESULT, WIRE_TYPE.LEN, resultContent)
  );
}

/**
 * Encode ClientSideToolV2Result proto: { tool, mcp_result, call_id, model_call_id, tool_index }
 * Represents the result of executing a tool
 */
function encodeClientSideToolV2Result(toolCallId, modelCallId, selectedTool, resultContent, toolIndex = 1) {
  return concatArrays(
    encodeField(FIELD.CV2R_TOOL, WIRE_TYPE.VARINT, CLIENT_SIDE_TOOL_V2_MCP),
    encodeField(FIELD.CV2R_MCP_RESULT, WIRE_TYPE.LEN, encodeMcpResult(selectedTool, resultContent)),
    encodeField(FIELD.CV2R_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    ...(modelCallId ? [encodeField(FIELD.CV2R_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : []),
    encodeField(FIELD.CV2R_TOOL_INDEX, WIRE_TYPE.VARINT, toolIndex > 0 ? toolIndex : 1)
  );
}

/**
 * Encode MCPParams.Tool nested inside ClientSideToolV2Call
 */
function encodeMcpParamsForCall(toolName, rawArgs, serverName) {
  const tool = concatArrays(
    encodeField(FIELD.MCP_TOOL_NAME, WIRE_TYPE.LEN, toolName),
    encodeField(FIELD.MCP_TOOL_PARAMS, WIRE_TYPE.LEN, rawArgs),
    encodeField(FIELD.MCP_TOOL_SERVER, WIRE_TYPE.LEN, serverName)
  );
  return encodeField(FIELD.MCP_TOOLS_LIST, WIRE_TYPE.LEN, tool);
}

/**
 * Encode ClientSideToolV2Call proto: { tool, mcp_params, call_id, name, raw_args, tool_index, model_call_id }
 * Represents a tool call definition
 */
function encodeClientSideToolV2Call(toolCallId, toolName, selectedTool, serverName, rawArgs, modelCallId, toolIndex = 1) {
  return concatArrays(
    encodeField(FIELD.CV2C_TOOL, WIRE_TYPE.VARINT, CLIENT_SIDE_TOOL_V2_MCP),
    encodeField(FIELD.CV2C_MCP_PARAMS, WIRE_TYPE.LEN, encodeMcpParamsForCall(selectedTool, rawArgs, serverName)),
    encodeField(FIELD.CV2C_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    encodeField(FIELD.CV2C_NAME, WIRE_TYPE.LEN, toolName),
    encodeField(FIELD.CV2C_RAW_ARGS, WIRE_TYPE.LEN, rawArgs),
    encodeField(FIELD.CV2C_TOOL_INDEX, WIRE_TYPE.VARINT, toolIndex > 0 ? toolIndex : 1),
    ...(modelCallId ? [encodeField(FIELD.CV2C_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : [])
  );
}

/**
 * Encode ConversationMessage.ToolResult with full structure
 * Matches Cursor proto: tool_call_id, tool_name, tool_index, raw_args, result, tool_call
 */
export function encodeToolResult(toolResult) {
  const originalName = toolResult.tool_name || toolResult.name || "";
  const toolName = formatToolName(originalName);
  const rawArgs = toolResult.raw_args || "{}";
  const resultContent = toolResult.result_content || toolResult.result || "";
  const { toolCallId, modelCallId } = parseToolId(toolResult.tool_call_id || "");
  const toolIndex = toolResult.tool_index || toolResult.index || 1;

  // Parse tool name to extract server and selected tool
  const { serverName, selectedTool } = parseToolName(toolName);

  return concatArrays(
    encodeField(FIELD.TOOL_RESULT_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    encodeField(FIELD.TOOL_RESULT_NAME, WIRE_TYPE.LEN, toolName),
    encodeField(FIELD.TOOL_RESULT_INDEX, WIRE_TYPE.VARINT, toolIndex > 0 ? toolIndex : 1),
    ...(modelCallId ? [encodeField(FIELD.TOOL_RESULT_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : []),
    encodeField(FIELD.TOOL_RESULT_RAW_ARGS, WIRE_TYPE.LEN, rawArgs),
    encodeField(FIELD.TOOL_RESULT_RESULT, WIRE_TYPE.LEN,
      encodeClientSideToolV2Result(toolCallId, modelCallId, selectedTool, resultContent, toolIndex)
    ),
    encodeField(FIELD.TOOL_RESULT_TOOL_CALL, WIRE_TYPE.LEN,
      encodeClientSideToolV2Call(toolCallId, toolName, selectedTool, serverName, rawArgs, modelCallId, toolIndex)
    )
  );
}

export function encodeMessage(content, role, messageId, chatModeEnum = null, isLast = false, hasTools = false, toolResults = [], serverBubbleId = null) {
  const hasToolResults = toolResults.length > 0;
  return concatArrays(
    encodeField(FIELD.MSG_CONTENT, WIRE_TYPE.LEN, content),
    encodeField(FIELD.MSG_ROLE, WIRE_TYPE.VARINT, role),
    encodeField(FIELD.MSG_ID, WIRE_TYPE.LEN, messageId),
    // Only include server_bubble_id if explicitly provided (last assistant message only)
    ...(serverBubbleId ? [encodeField(FIELD.MSG_SERVER_BUBBLE_ID, WIRE_TYPE.LEN, serverBubbleId)] : []),
    ...(hasToolResults ? toolResults.map(tr =>
      encodeField(FIELD.MSG_TOOL_RESULTS, WIRE_TYPE.LEN, encodeToolResult(tr))
    ) : []),
    encodeField(FIELD.MSG_IS_AGENTIC, WIRE_TYPE.VARINT, hasTools ? 1 : 0),
    encodeField(FIELD.MSG_UNIFIED_MODE, WIRE_TYPE.VARINT, hasTools ? UNIFIED_MODE.AGENT : UNIFIED_MODE.CHAT),
    ...(isLast && hasTools ? [encodeField(FIELD.MSG_SUPPORTED_TOOLS, WIRE_TYPE.LEN, encodeVarint(1))] : [])
  );
}

export function encodeInstruction(text) {
  return text ? encodeField(FIELD.INSTRUCTION_TEXT, WIRE_TYPE.LEN, text) : new Uint8Array(0);
}

export function encodeModel(modelName) {
  return concatArrays(
    encodeField(FIELD.MODEL_NAME, WIRE_TYPE.LEN, modelName),
    encodeField(FIELD.MODEL_EMPTY, WIRE_TYPE.LEN, new Uint8Array(0))
  );
}

export function encodeCursorSetting() {
  const unknown6 = concatArrays(
    encodeField(FIELD.SETTING6_FIELD_1, WIRE_TYPE.LEN, new Uint8Array(0)),
    encodeField(FIELD.SETTING6_FIELD_2, WIRE_TYPE.LEN, new Uint8Array(0))
  );

  return concatArrays(
    encodeField(FIELD.SETTING_PATH, WIRE_TYPE.LEN, "cursor\\aisettings"),
    encodeField(FIELD.SETTING_UNKNOWN_3, WIRE_TYPE.LEN, new Uint8Array(0)),
    encodeField(FIELD.SETTING_UNKNOWN_6, WIRE_TYPE.LEN, unknown6),
    encodeField(FIELD.SETTING_UNKNOWN_8, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.SETTING_UNKNOWN_9, WIRE_TYPE.VARINT, 1)
  );
}

export function encodeMetadata() {
  return concatArrays(
    encodeField(FIELD.META_PLATFORM, WIRE_TYPE.LEN, process.platform || "linux"),
    encodeField(FIELD.META_ARCH, WIRE_TYPE.LEN, process.arch || "x64"),
    encodeField(FIELD.META_VERSION, WIRE_TYPE.LEN, process.version || "v20.0.0"),
    encodeField(FIELD.META_CWD, WIRE_TYPE.LEN, process.cwd?.() || "/"),
    encodeField(FIELD.META_TIMESTAMP, WIRE_TYPE.LEN, new Date().toISOString())
  );
}

export function encodeMessageId(messageId, role, summaryId = null) {
  return concatArrays(
    encodeField(FIELD.MSGID_ID, WIRE_TYPE.LEN, messageId),
    ...(summaryId ? [encodeField(FIELD.MSGID_SUMMARY, WIRE_TYPE.LEN, summaryId)] : []),
    encodeField(FIELD.MSGID_ROLE, WIRE_TYPE.VARINT, role)
  );
}

export function encodeMcpTool(tool) {
  const toolName = tool.function?.name || tool.name || "";
  const toolDesc = tool.function?.description || tool.description || "";
  const inputSchema = tool.function?.parameters || tool.input_schema || {};

  return concatArrays(
    ...(toolName ? [encodeField(FIELD.MCP_TOOL_NAME, WIRE_TYPE.LEN, toolName)] : []),
    ...(toolDesc ? [encodeField(FIELD.MCP_TOOL_DESC, WIRE_TYPE.LEN, toolDesc)] : []),
    ...(Object.keys(inputSchema).length > 0 ? [encodeField(FIELD.MCP_TOOL_PARAMS, WIRE_TYPE.LEN, JSON.stringify(inputSchema))] : []),
    encodeField(FIELD.MCP_TOOL_SERVER, WIRE_TYPE.LEN, "custom")
  );
}

// ==================== AGENT SERVICE v2 — MCP TOOL PROTOCOL ====================
//
// Cursor's AgentService (agent.api5.cursor.sh) carries MCP tools + results in a
// v2 wire shape distinct from the legacy ChatService ClientSideToolV2 messages:
//
//   McpToolDefinition { name(1), description(2), input_schema(3=Value),
//                       provider(4), tool_name(5) }
//   McpTools          { tool(1, repeated McpToolDefinition) }
//   McpArgs           { name(1), args(2, map<string, Value>),
//                       tool_call_id(3), tool_name(5) }
//   McpResult         { success(1), error(2), tool_not_found(5) }
//     success         { content(1, repeated ContentItem), is_error(2) }
//       ContentItem   { text(1), image(2) }
//         Text        { text(1) }
//         Image       { data(1), mime_type(2) }
//
// google.protobuf.Value encodes: null → null_value(1), bool → bool_value(2),
// number → number_value(3), string → string_value(4), object → struct_value(5),
// array → list_value(6). Decoding mirrors encodeAgentValue exactly so the
// round-trip is lossless for plain JSON data.

const VALUE_NULL = 1;
const VALUE_BOOL = 2;
const VALUE_NUMBER = 3;
const VALUE_STRING = 4;
const VALUE_STRUCT = 5;
const VALUE_LIST = 6;

/** Encode a plain JSON value as google.protobuf.Value. */
export function encodeAgentValue(value) {
  if (value === null || value === undefined) {
    return encodeField(VALUE_NULL, WIRE_TYPE.VARINT, 0);
  }
  if (typeof value === "boolean") {
    return encodeField(VALUE_BOOL, WIRE_TYPE.VARINT, value ? 1 : 0);
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return encodeField(VALUE_NUMBER, WIRE_TYPE.VARINT, value);
    }
    // Non-integer floats ride FIXED64 as an IEEE-754 double (VARINT would
    // truncate 3.14 → 3). encodeField has no FIXED64 branch, so build the
    // tag + payload manually.
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(value, 0);
    return concatArrays(encodeVarint((VALUE_NUMBER << 3) | WIRE_TYPE.FIXED64), new Uint8Array(buf));
  }
  if (typeof value === "string") {
    return encodeField(VALUE_STRING, WIRE_TYPE.LEN, value);
  }
  if (Array.isArray(value)) {
    // ListValue { value(1, repeated Value) } — each item is wrapped on field 1.
    return encodeField(VALUE_LIST, WIRE_TYPE.LEN,
      concatArrays(...value.map((item) => encodeField(1, WIRE_TYPE.LEN, encodeAgentValue(item)))));
  }
  if (value && typeof value === "object") {
    const entries = [];
    for (const [k, v] of Object.entries(value)) {
      entries.push(
        encodeField(1, WIRE_TYPE.LEN, k),
        encodeField(2, WIRE_TYPE.LEN, encodeAgentValue(v)),
      );
    }
    return encodeField(VALUE_STRUCT, WIRE_TYPE.LEN, concatArrays(...entries));
  }
  return encodeField(VALUE_STRING, WIRE_TYPE.LEN, String(value));
}

/**
 * Walk raw protobuf bytes field-by-field, invoking onField in wire order.
 * decodeMessage groups by field number — fine for scalars, but struct/list
 * entries pair sequential fields (1=key/2=value), so order must survive.
 */
function walkFields(bytes, onField) {
  let pos = 0;
  while (pos < bytes.length) {
    const [fieldNum, wireType, value, newPos] = decodeField(bytes, pos);
    if (fieldNum === null) break;
    onField(fieldNum, wireType, value);
    pos = newPos;
  }
}

/** Decode google.protobuf.Struct — alternating field-1 (key) / field-2 (value). */
function decodeStruct(bytes) {
  const out = {};
  let pendingKey = null;
  walkFields(bytes, (fieldNum, _wireType, value) => {
    if (fieldNum === 1) {
      pendingKey = Buffer.from(value).toString("utf8");
    } else if (fieldNum === 2 && pendingKey !== null) {
      out[pendingKey] = decodeAgentValue(value);
      pendingKey = null;
    }
  });
  return out;
}

/** Decode google.protobuf.ListValue — repeated field-1 Values. */
function decodeList(bytes) {
  const out = [];
  walkFields(bytes, (fieldNum, _wireType, value) => {
    if (fieldNum === 1) out.push(decodeAgentValue(value));
  });
  return out;
}

/** Decode a google.protobuf.Value back into plain JSON data. */
export function decodeAgentValue(bytes) {
  const msg = decodeMessage(bytes);
  if (msg.has(VALUE_NULL)) return null;
  if (msg.has(VALUE_BOOL)) return msg.get(VALUE_BOOL)[0].value !== 0;
  if (msg.has(VALUE_NUMBER)) {
    const field = msg.get(VALUE_NUMBER)[0];
    return field.wireType === WIRE_TYPE.FIXED64 ? Buffer.from(field.value).readDoubleLE(0) : field.value;
  }
  if (msg.has(VALUE_STRING)) return Buffer.from(msg.get(VALUE_STRING)[0].value).toString("utf8");
  if (msg.has(VALUE_LIST)) return decodeList(msg.get(VALUE_LIST)[0].value);
  if (msg.has(VALUE_STRUCT)) return decodeStruct(msg.get(VALUE_STRUCT)[0].value);
  return undefined;
}

/** Encode a McpToolDefinition message (name/desc/schema/provider/tool_name). */
export function encodeMcpToolDefinition(tool) {
  const name = tool.function?.name || tool.name || "";
  const description = tool.function?.description || tool.description || "";
  const inputSchema = tool.function?.parameters || tool.input_schema || {};
  return concatArrays(
    ...(name ? [encodeField(1, WIRE_TYPE.LEN, name)] : []),
    ...(description ? [encodeField(2, WIRE_TYPE.LEN, description)] : []),
    ...(Object.keys(inputSchema).length > 0 ? [encodeField(3, WIRE_TYPE.LEN, encodeAgentValue(inputSchema))] : []),
    encodeField(4, WIRE_TYPE.LEN, "Vela"),
    ...(name ? [encodeField(5, WIRE_TYPE.LEN, name)] : []),
  );
}

/** Encode a McpTools message: repeated McpToolDefinition on field 1. */
export function encodeMcpTools(tools) {
  const list = Array.isArray(tools) ? tools : [];
  if (list.length === 0) return new Uint8Array(0);
  return concatArrays(...list.map((tool) => encodeField(1, WIRE_TYPE.LEN, encodeMcpToolDefinition(tool))));
}

/** Decode a McpArgs message into { name, toolName, toolCallId, args }. */
export function decodeMcpArgs(bytes) {
  const msg = decodeMessage(bytes);
  const read = (n) => (msg.has(n) ? Buffer.from(msg.get(n)[0].value).toString("utf8") : undefined);
  const args = {};
  for (const field of msg.get(2) ?? []) {
    const entry = decodeMessage(field.value);
    const key = Buffer.from(entry.get(1)[0].value).toString("utf8");
    const val = entry.get(2)?.[0]?.value;
    args[key] = val ? decodeAgentValue(val) : undefined;
  }
  return {
    name: read(1),
    toolName: read(5),
    toolCallId: read(3),
    args,
  };
}

/** Encode a McpResult.success — text + optional image content items. */
export function encodeMcpResultSuccess({ textItems = [], imageItems = [], isError = false } = {}) {
  // ContentItem: field 1 = text variant (nested Text { text(1) }), field 2 = image.
  const contentItems = [
    ...(Array.isArray(textItems) ? textItems.map((text) =>
      encodeField(1, WIRE_TYPE.LEN, encodeField(1, WIRE_TYPE.LEN, String(text)))) : []),
    ...(Array.isArray(imageItems) ? imageItems.map((img) =>
      encodeField(2, WIRE_TYPE.LEN,
        concatArrays(
          encodeField(1, WIRE_TYPE.LEN, img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data || [])),
          encodeField(2, WIRE_TYPE.LEN, img.mimeType || "image/png"),
        ))) : []),
  ];
  // success { content(1, repeated), is_error(2) } — each item is its own field-1.
  const success = concatArrays(
    ...contentItems.map((item) => encodeField(1, WIRE_TYPE.LEN, item)),
    encodeField(2, WIRE_TYPE.VARINT, isError ? 1 : 0),
  );
  // McpResult { success(1) }.
  return encodeField(1, WIRE_TYPE.LEN, success);
}

/** Encode a McpResult.error — the message rides field 1 of the error message. */
export function encodeMcpResultError(message) {
  const error = encodeField(1, WIRE_TYPE.LEN, String(message || "tool error"));
  return encodeField(2, WIRE_TYPE.LEN, error);
}

/** Encode a McpResult.tool_not_found — the tool name rides field 1. */
export function encodeMcpResultToolNotFound(toolName) {
  const notFound = encodeField(1, WIRE_TYPE.LEN, String(toolName || ""));
  return encodeField(5, WIRE_TYPE.LEN, notFound);
}

// ==================== REQUEST BUILDING ====================

export function encodeRequest(messages, modelName, tools = [], reasoningEffort = null, forceAgentMode = false) {
  const hasTools = tools?.length > 0;
  const isAgentic = hasTools || forceAgentMode;
  const formattedMessages = [];
  const messageIds = [];
  const normalizedMessages = [];

  // Guardrail: split mixed assistant payload into separate assistant messages
  // This prevents protobuf encoding errors when tool calls and results are in same message
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
    const hasToolResults = Array.isArray(msg?.tool_results) && msg.tool_results.length > 0;

    if (msg?.role === "assistant" && hasToolCalls && hasToolResults) {
      log(
        "ENCODE",
        `normalizing mixed assistant tool payload at msg[${i}] (calls=${msg.tool_calls.length}, results=${msg.tool_results.length})`
      );

      // Keep assistant tool call message without embedded results
      normalizedMessages.push({
        ...msg,
        tool_results: []
      });

      // Avoid inserting duplicate assistant tool-result message if next one already matches
      const nextMsg = messages[i + 1];
      const nextHasToolResults =
        nextMsg?.role === "assistant" &&
        Array.isArray(nextMsg?.tool_results) &&
        nextMsg.tool_results.length > 0;
      const currentIds = new Set(
        msg.tool_results.map(tr => tr?.tool_call_id).filter(id => typeof id === "string")
      );
      const nextIds = new Set(
        (nextMsg?.tool_results || [])
          .map(tr => tr?.tool_call_id)
          .filter(id => typeof id === "string")
      );
      let sameIds = currentIds.size > 0 && currentIds.size === nextIds.size;
      if (sameIds) {
        for (const id of currentIds) {
          if (!nextIds.has(id)) {
            sameIds = false;
            break;
          }
        }
      }

      if (!(nextHasToolResults && sameIds)) {
        normalizedMessages.push({
          role: "assistant",
          content: "",
          tool_results: msg.tool_results
        });
      }

      continue;
    }

    normalizedMessages.push(msg);
  }

  // Prepare messages
  for (let i = 0; i < normalizedMessages.length; i++) {
    const msg = normalizedMessages[i];
    const role = msg.role === "user" ? ROLE.USER : ROLE.ASSISTANT;
    const msgId = uuidv4();
    const isLast = i === normalizedMessages.length - 1;

    formattedMessages.push({
      content: msg.content,
      role,
      messageId: msgId,
      isLast,
      hasTools,
      toolResults: msg.tool_results || []
    });

    messageIds.push({ messageId: msgId, role });
  }

  // Map reasoning effort to thinking level
  let thinkingLevel = THINKING_LEVEL.UNSPECIFIED;
  if (reasoningEffort === "medium") thinkingLevel = THINKING_LEVEL.MEDIUM;
  else if (reasoningEffort === "high") thinkingLevel = THINKING_LEVEL.HIGH;

  // Build request
  return concatArrays(
    // Messages
    ...formattedMessages.map(fm => 
      encodeField(FIELD.MESSAGES, WIRE_TYPE.LEN, 
        encodeMessage(fm.content, fm.role, fm.messageId, null, fm.isLast, fm.hasTools, fm.toolResults)
      )
    ),
    
    // Static fields
    encodeField(FIELD.UNKNOWN_2, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.INSTRUCTION, WIRE_TYPE.LEN, encodeInstruction("")),
    encodeField(FIELD.UNKNOWN_4, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.MODEL, WIRE_TYPE.LEN, encodeModel(modelName)),
    encodeField(FIELD.WEB_TOOL, WIRE_TYPE.LEN, ""),
    encodeField(FIELD.UNKNOWN_13, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.CURSOR_SETTING, WIRE_TYPE.LEN, encodeCursorSetting()),
    encodeField(FIELD.UNKNOWN_19, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.CONVERSATION_ID, WIRE_TYPE.LEN, uuidv4()),
    encodeField(FIELD.METADATA, WIRE_TYPE.LEN, encodeMetadata()),

    // Tool-related fields
    encodeField(FIELD.IS_AGENTIC, WIRE_TYPE.VARINT, isAgentic ? 1 : 0),
    ...(isAgentic ? [encodeField(FIELD.SUPPORTED_TOOLS, WIRE_TYPE.LEN, encodeVarint(1))] : []),
    
    // Message IDs
    ...messageIds.map(mid => 
      encodeField(FIELD.MESSAGE_IDS, WIRE_TYPE.LEN, encodeMessageId(mid.messageId, mid.role))
    ),

    // MCP Tools
    ...(tools?.length > 0 ? tools.map(tool => 
      encodeField(FIELD.MCP_TOOLS, WIRE_TYPE.LEN, encodeMcpTool(tool))
    ) : []),

    // Mode fields
    encodeField(FIELD.LARGE_CONTEXT, WIRE_TYPE.VARINT, 0),
    encodeField(FIELD.UNKNOWN_38, WIRE_TYPE.VARINT, 0),
    encodeField(FIELD.UNIFIED_MODE, WIRE_TYPE.VARINT, isAgentic ? UNIFIED_MODE.AGENT : UNIFIED_MODE.CHAT),
    encodeField(FIELD.UNKNOWN_47, WIRE_TYPE.LEN, ""),
    encodeField(FIELD.SHOULD_DISABLE_TOOLS, WIRE_TYPE.VARINT, isAgentic ? 0 : 1),
    encodeField(FIELD.THINKING_LEVEL, WIRE_TYPE.VARINT, thinkingLevel),
    encodeField(FIELD.UNKNOWN_51, WIRE_TYPE.VARINT, 0),
    encodeField(FIELD.UNKNOWN_53, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.UNIFIED_MODE_NAME, WIRE_TYPE.LEN, isAgentic ? "Agent" : "Ask")
  );
}

export function buildChatRequest(messages, modelName, tools = [], reasoningEffort = null, forceAgentMode = false) {
  return encodeField(FIELD.REQUEST, WIRE_TYPE.LEN, encodeRequest(messages, modelName, tools, reasoningEffort, forceAgentMode));
}

/**
 * Encode a tool result as ClientSideToolV2Result (field 2 of StreamUnifiedChatRequestWithTools)
 * This is sent as a SEPARATE request frame, not inside conversation messages.
 * Proto: StreamUnifiedChatRequestWithTools.client_side_tool_v2_result = 2
 */
export function buildToolResultRequest(toolResult) {
  const { toolCallId, modelCallId } = parseToolId(toolResult.tool_call_id || "");
  const rawName = toolResult.tool_name || "";
  const resultContent = toolResult.result_content || "";

  // selected_tool = raw tool name (e.g. "Write", "Read") per cursor-api Rust source:
  // McpResult { selected_tool: tool_name, result } where tool_name is the mcpParams.tools[0].name
  // which is the name AFTER server prefix stripping (e.g. "custom_Write" -> name = "Write")
  // Actually cursor-api uses: name = tool_name.slice_unchecked(d+1..) → raw name without "custom_"
  // So selected_tool = raw tool name without any prefix
  const selectedTool = rawName.startsWith("mcp_custom_")
    ? rawName.slice("mcp_custom_".length)
    : rawName.startsWith("mcp_")
    ? rawName.slice(4)
    : rawName;

  // ClientSideToolV2Result per proto:
  //   field 1 (tool): varint = 19 (MCP)
  //   field 28 (mcp_result): LEN { field 1: selected_tool, field 2: result }
  //   field 35 (tool_call_id): string
  //   field 48 (model_call_id): string (optional)
  //   NO tool_index (None in Rust source: encode_tool_result sets tool_index: None)
  const cv2Result = concatArrays(
    encodeField(FIELD.CV2R_TOOL, WIRE_TYPE.VARINT, CLIENT_SIDE_TOOL_V2_MCP),
    encodeField(FIELD.CV2R_MCP_RESULT, WIRE_TYPE.LEN, encodeMcpResult(selectedTool, resultContent)),
    encodeField(FIELD.CV2R_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    ...(modelCallId ? [encodeField(FIELD.CV2R_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : [])
    // tool_index intentionally omitted (None per Rust source)
  );

  // StreamUnifiedChatRequestWithTools: field 2 = client_side_tool_v2_result
  return encodeField(2, WIRE_TYPE.LEN, cv2Result);
}

export function wrapConnectRPCFrame(payload, compress = false) {
  let finalPayload = payload;
  let flags = 0x00;

  if (compress) {
    finalPayload = new Uint8Array(zlib.gzipSync(Buffer.from(payload)));
    flags = 0x01;
  }

  const frame = new Uint8Array(5 + finalPayload.length);
  frame[0] = flags;
  frame[1] = (finalPayload.length >> 24) & 0xFF;
  frame[2] = (finalPayload.length >> 16) & 0xFF;
  frame[3] = (finalPayload.length >> 8) & 0xFF;
  frame[4] = finalPayload.length & 0xFF;
  frame.set(finalPayload, 5);

  return frame;
}

export function generateCursorBody(messages, modelName, tools = [], reasoningEffort = null, forceAgentMode = false) {
  log("BODY", `Generating: ${messages.length} msgs, model=${modelName}, tools=${tools.length}, reasoning=${reasoningEffort || "none"}, forceAgentMode=${forceAgentMode}`);
  
  const protobuf = buildChatRequest(messages, modelName, tools, reasoningEffort, forceAgentMode);
  const framed = wrapConnectRPCFrame(protobuf, false); // Cursor doesn't support compressed requests
  
  log("BODY", `Protobuf=${protobuf.length}B, Framed=${framed.length}B`);
  return framed;
}

/**
 * Generate a framed tool result body to send as a separate request frame.
 * Uses field 2 (client_side_tool_v2_result) of StreamUnifiedChatRequestWithTools.
 */
export function generateToolResultBody(toolResult) {
  const protobuf = buildToolResultRequest(toolResult);
  return wrapConnectRPCFrame(protobuf, false);
}

// ==================== PRIMITIVE DECODING ====================

export function decodeVarint(buffer, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;

  while (pos < buffer.length) {
    const b = buffer[pos];
    result |= (b & 0x7F) << shift;
    pos++;
    if (!(b & 0x80)) break;
    shift += 7;
  }

  return [result, pos];
}

export function decodeField(buffer, offset) {
  if (offset >= buffer.length) return [null, null, null, offset];

  const [tag, pos1] = decodeVarint(buffer, offset);
  const fieldNum = tag >> 3;
  const wireType = tag & 0x07;

  let value;
  let pos = pos1;

  if (wireType === WIRE_TYPE.VARINT) {
    [value, pos] = decodeVarint(buffer, pos);
  } else if (wireType === WIRE_TYPE.LEN) {
    const [length, pos2] = decodeVarint(buffer, pos);
    value = buffer.slice(pos2, pos2 + length);
    pos = pos2 + length;
  } else if (wireType === WIRE_TYPE.FIXED64) {
    value = buffer.slice(pos, pos + 8);
    pos += 8;
  } else if (wireType === WIRE_TYPE.FIXED32) {
    value = buffer.slice(pos, pos + 4);
    pos += 4;
  } else {
    value = null;
  }

  return [fieldNum, wireType, value, pos];
}

export function decodeMessage(data) {
  const fields = new Map();
  let pos = 0;

  while (pos < data.length) {
    const [fieldNum, wireType, value, newPos] = decodeField(data, pos);
    if (fieldNum === null) break;

    if (!fields.has(fieldNum)) fields.set(fieldNum, []);
    fields.get(fieldNum).push({ wireType, value });
    pos = newPos;
  }

  return fields;
}

// ==================== RESPONSE PARSING ====================

export function parseConnectRPCFrame(buffer) {
  if (buffer.length < 5) return null;

  const flags = buffer[0];
  const length = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];

  if (buffer.length < 5 + length) return null;

  let payload = buffer.slice(5, 5 + length);

  // Decompress if gzip
  if (flags === 0x01) {
    try {
      payload = new Uint8Array(zlib.gunzipSync(Buffer.from(payload)));
    } catch (err) {
      log("PARSE", `Decompression failed: ${err.message}`);
    }
  }

  return { flags, length, payload, consumed: 5 + length };
}

function extractToolCall(toolCallData) {
  const toolCall = decodeMessage(toolCallData);
  let toolCallId = "";
  let toolName = "";
  let rawArgs = "";
  let isLast = false;

  // Extract tool call ID
  if (toolCall.has(FIELD.TOOL_ID)) {
    const fullId = new TextDecoder().decode(toolCall.get(FIELD.TOOL_ID)[0].value);
    toolCallId = fullId.split("\n")[0]; // Cursor returns multi-line ID, take first line
  }

  // Extract tool name
  if (toolCall.has(FIELD.TOOL_NAME)) {
    toolName = new TextDecoder().decode(toolCall.get(FIELD.TOOL_NAME)[0].value);
  }

  // Extract is_last flag
  if (toolCall.has(FIELD.TOOL_IS_LAST)) {
    isLast = toolCall.get(FIELD.TOOL_IS_LAST)[0].value !== 0;
  }

  // Extract MCP params - nested real tool info
  if (toolCall.has(FIELD.TOOL_MCP_PARAMS)) {
    try {
      const mcpParams = decodeMessage(toolCall.get(FIELD.TOOL_MCP_PARAMS)[0].value);
      
      if (mcpParams.has(FIELD.MCP_TOOLS_LIST)) {
        const tool = decodeMessage(mcpParams.get(FIELD.MCP_TOOLS_LIST)[0].value);
        
        if (tool.has(FIELD.MCP_NESTED_NAME)) {
          toolName = new TextDecoder().decode(tool.get(FIELD.MCP_NESTED_NAME)[0].value);
        }
        
        if (tool.has(FIELD.MCP_NESTED_PARAMS)) {
          rawArgs = new TextDecoder().decode(tool.get(FIELD.MCP_NESTED_PARAMS)[0].value);
        }
      }
    } catch (err) {
      log("EXTRACT", `MCP parse error: ${err.message}`);
    }
  }

  // Fallback to raw_args
  if (!rawArgs && toolCall.has(FIELD.TOOL_RAW_ARGS)) {
    rawArgs = new TextDecoder().decode(toolCall.get(FIELD.TOOL_RAW_ARGS)[0].value);
  }

  if (toolCallId && toolName) {
    return {
      id: toolCallId,
      type: "function",
      function: {
        name: toolName,
        arguments: rawArgs || "{}"
      },
      isLast
    };
  }

  return null;
}

function extractTextAndThinking(responseData) {
  const nested = decodeMessage(responseData);
  let text = null;
  let thinking = null;

  // Extract text
  if (nested.has(FIELD.RESPONSE_TEXT)) {
    text = new TextDecoder().decode(nested.get(FIELD.RESPONSE_TEXT)[0].value);
  }

  // Extract thinking
  if (nested.has(FIELD.THINKING)) {
    try {
      const thinkingMsg = decodeMessage(nested.get(FIELD.THINKING)[0].value);
      if (thinkingMsg.has(FIELD.THINKING_TEXT)) {
        thinking = new TextDecoder().decode(thinkingMsg.get(FIELD.THINKING_TEXT)[0].value);
      }
    } catch (err) {
      log("EXTRACT", `Thinking parse error: ${err.message}`);
    }
  }

  return { text, thinking };
}

export function extractTextFromResponse(payload) {
  try {
    const fields = decodeMessage(payload);

    // Warn about unknown field numbers — may indicate a Cursor protocol update
    for (const fieldNum of fields.keys()) {
      if (!KNOWN_RESPONSE_FIELDS.has(fieldNum)) {
        log(
          "SCHEMA",
          `Unknown response field #${fieldNum} detected. Schema v${PROTOBUF_SCHEMA_VERSION} may be outdated.`
        );
      }
    }

    // Field 1: ClientSideToolV2Call
    if (fields.has(FIELD.TOOL_CALL)) {
      const toolCall = extractToolCall(fields.get(FIELD.TOOL_CALL)[0].value);
      if (toolCall) {
        log("EXTRACT", `Tool call: ${toolCall.function.name}`);
        return { text: null, error: null, toolCall, thinking: null };
      }
    }

    // Field 2: StreamUnifiedChatResponse
    if (fields.has(FIELD.RESPONSE)) {
      const { text, thinking } = extractTextAndThinking(fields.get(FIELD.RESPONSE)[0].value);

      if (text || thinking) {
        return { text, error: null, toolCall: null, thinking };
      }
    }

    return { text: null, error: null, toolCall: null, thinking: null };
  } catch (err) {
    log("EXTRACT", `Decode failed (schema v${PROTOBUF_SCHEMA_VERSION}): ${err.message}`);
    return {
      text: null,
      error: null,
      toolCall: null,
      thinking: null,
      raw: Buffer.from(payload).toString("base64"),
      decodeError: err.message
    };
  }
}

// ==================== EXPORTS ====================

export default {
  encodeVarint,
  encodeField,
  encodeMessage,
  buildChatRequest,
  wrapConnectRPCFrame,
  generateCursorBody,
  decodeVarint,
  decodeField,
  decodeMessage,
  parseConnectRPCFrame,
  extractTextFromResponse
};
