// Static model of the @earendil-works/pi-ai 0.86.0 surface used by tests/pi-contrats/fournisseur-scripte.ts
// (createAssistantMessageEventStream, push, end), for the S4 TypeScript profile only. No file imports
// this declaration and nothing is loaded at run time; under pi the real package is used.
// Verbatim copies, with `export declare` written `export` inside the ambient module, of the transitive
// closure of that surface in the pi 0.86.0 install:
//   dist/utils/event-stream.d.ts  5340224387a0b7c1413b4733e4b009faecc87f090b43658c470d53d0cf0e7c82
//   dist/types.d.ts               e3ca23bf2ae885f456908d585823b527c118faa103d76ca2543306a88bc84ebd
//   dist/utils/diagnostics.d.ts   ca69c6883f6a82f8e87dd87b0d8f4ef8b643cafda20eaaaf1dffb633f4fc6ce6
// Any other member of the package stays undeclared: importing it is a diagnostic.
declare module "@earendil-works/pi-ai" {
  export type KnownApi = "openai-completions" | "mistral-conversations" | "openai-responses" | "azure-openai-responses" | "openai-codex-responses" | "anthropic-messages" | "bedrock-converse-stream" | "google-generative-ai" | "google-vertex" | "pi-messages";
  export type Api = KnownApi | (string & {});
  export type KnownProvider = "amazon-bedrock" | "ant-ling" | "anthropic" | "google" | "google-vertex" | "openai" | "azure-openai-responses" | "openai-codex" | "radius" | "nvidia" | "deepseek" | "github-copilot" | "xai" | "groq" | "cerebras" | "openrouter" | "vercel-ai-gateway" | "zai" | "zai-coding-cn" | "mistral" | "minimax" | "minimax-cn" | "moonshotai" | "moonshotai-cn" | "huggingface" | "fireworks" | "together" | "baseten" | "opencode" | "opencode-go" | "kimi-coding" | "cloudflare-workers-ai" | "cloudflare-ai-gateway" | "qwen-token-plan" | "qwen-token-plan-cn" | "qwen-token-plan-individual" | "xiaomi" | "xiaomi-token-plan-cn" | "xiaomi-token-plan-ams" | "xiaomi-token-plan-sgp";
  export type ProviderId = KnownProvider | string;
  export interface TextContent {
      type: "text";
      text: string;
      textSignature?: string;
  }
  export interface ThinkingContent {
      type: "thinking";
      thinking: string;
      thinkingSignature?: string;
      /** When true, the thinking content was redacted by safety filters. The opaque
       *  encrypted payload is stored in `thinkingSignature` so it can be passed back
       *  to the API for multi-turn continuity. */
      redacted?: boolean;
  }
  export interface ToolCall {
      type: "toolCall";
      id: string;
      name: string;
      arguments: JsonObject;
      thoughtSignature?: string;
      /** OpenAI Responses namespace for calls to dynamically loaded or namespaced tools. */
      namespace?: string;
  }
  export interface Usage {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      /** Subset of `cacheWrite` written with 1h retention. Only Anthropic reports this split. */
      cacheWrite1h?: number;
      /**
       * Reasoning/thinking tokens, when the provider reports them. This is a subset of
       * `output`: `output` already includes these tokens. Set to a number (possibly 0) by
       * providers that expose a reasoning breakdown; left undefined by providers that don't.
       */
      reasoning?: number;
      totalTokens: number;
      cost: {
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
          total: number;
      };
  }
  export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
  export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
  export type JsonObject = {
      [key: string]: JsonValue;
  };
  export interface DeferredHandle {
      provider: string;
      modelId: string;
      api: string;
      /** Provider token, such as a response id or batch id plus row id. */
      id: string;
      expiresAt?: number;
      pollAfterMs?: number;
      /** Provider conversion data required to reconstruct the final assistant message. */
      data?: JsonValue;
  }
  export interface DiagnosticErrorInfo {
      name?: string;
      message: string;
      stack?: string;
      code?: string | number;
  }
  export interface AssistantMessageDiagnostic {
      type: string;
      timestamp: number;
      error?: DiagnosticErrorInfo;
      details?: JsonObject;
  }
  export interface AssistantMessage {
      role: "assistant";
      content: (TextContent | ThinkingContent | ToolCall)[];
      api: Api;
      provider: ProviderId;
      model: string;
      responseModel?: string;
      responseId?: string;
      /** Exact provider-native effort level used for this response. Absent for legacy or unmanaged responses. */
      providerThinkingLevel?: string;
      diagnostics?: AssistantMessageDiagnostic[];
      usage: Usage;
      stopReason: StopReason;
      deferred?: DeferredHandle;
      errorMessage?: string;
      rawStopReason?: string;
      /**
       * Provider indication of whether the model explicitly ended its turn.
       * Preserved for debugging and does not currently affect agent control flow.
       */
      endTurn?: boolean;
      timestamp: number;
  }
  /**
   * Event protocol for AssistantMessageEventStream.
   *
   * Successful streams emit `start` before partial updates and terminate with
   * `done`. A stream may terminate directly with `error` when request setup fails
   * before generation starts; after `start`, failures also terminate with `error`.
   * Direct `streamSimple()` calls throw synchronously when request auth is missing.
   * Updates and `done` must never appear before `start`.
   *
   * `partial` is the shared live response-so-far helper, not an event-time
   * snapshot. Text and thinking blocks are empty when their `*_start` event is
   * emitted and grow only through their corresponding `*_delta` events until the
   * authoritative `*_end`. Redacted thinking may be complete at start and emit no
   * deltas. Tool-call arguments at `toolcall_start` are provider-specific;
   * `toolcall_delta` carries subsequent JSON updates.
   */
  export type AssistantMessageEvent = {
      type: "start";
      partial: AssistantMessage;
  } | {
      type: "text_start";
      contentIndex: number;
      partial: AssistantMessage;
  } | {
      type: "text_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
  } | {
      type: "text_end";
      contentIndex: number;
      content: string;
      partial: AssistantMessage;
  } | {
      type: "thinking_start";
      contentIndex: number;
      partial: AssistantMessage;
  } | {
      type: "thinking_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
  } | {
      type: "thinking_end";
      contentIndex: number;
      content: string;
      partial: AssistantMessage;
  } | {
      type: "toolcall_start";
      contentIndex: number;
      partial: AssistantMessage;
  } | {
      type: "toolcall_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
  } | {
      type: "toolcall_end";
      contentIndex: number;
      toolCall: ToolCall;
      partial: AssistantMessage;
  } | {
      type: "done";
      reason: Extract<StopReason, "stop" | "length" | "toolUse" | "deferred">;
      message: AssistantMessage;
  } | {
      type: "error";
      reason: Extract<StopReason, "aborted" | "error">;
      error: AssistantMessage;
  };
  export class EventStream<T, R = T> implements AsyncIterable<T> {
      private queue;
      private waiting;
      private done;
      private finalResultPromise;
      private resolveFinalResult;
      private isComplete;
      private extractResult;
      constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R);
      push(event: T): void;
      end(result?: R): void;
      [Symbol.asyncIterator](): AsyncIterator<T>;
      result(): Promise<R>;
  }
  export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
      constructor();
  }
  /** Factory function for AssistantMessageEventStream (for use in extensions) */
  export function createAssistantMessageEventStream(): AssistantMessageEventStream;
}
