// A loopback, LM Studio-compatible model API for the Code Mode host test: `/v1/models` lists one model, and
// `/v1/chat/completions` streams the next scripted tool call, then "Done." after the tool results. No model leaves the
// machine.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

export const MODEL_ID = "browse-fake-model"

export interface ScriptedCall {
  readonly tool: string
  readonly arguments: Record<string, unknown>
}

export interface FakeModel {
  readonly baseUrl: string
  /** The calls the model makes, one per turn, before it answers with text. */
  script: ScriptedCall[]
  /** Every chat request body, in order. */
  readonly requests: unknown[]
  close(): Promise<void>
}

const read = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => resolve(body))
    request.on("error", reject)
  })

export async function startFakeModel(): Promise<FakeModel> {
  const model = { script: [] as ScriptedCall[], requests: [] as unknown[] } as unknown as FakeModel
  const server = createServer(async (request, response) => {
    const url = request.url ?? "/"
    if (url === "/api/v1/models") {
      return json(response, {
        models: [{ type: "llm", key: MODEL_ID, display_name: "Fake model", loaded_instances: [], max_context_length: 32_000, capabilities: { vision: false, trained_for_tool_use: true } }],
      })
    }
    if (url === "/v1/models") return json(response, { data: [{ id: MODEL_ID, object: "model" }] })
    if (url === "/v1/chat/completions" && request.method === "POST") return chat(response, await read(request))
    response.writeHead(404).end()
  })
  const chat = (response: ServerResponse, body: string) => {
    const parsed = JSON.parse(body) as { tools?: unknown[]; messages?: { role: string }[] }
    model.requests.push(parsed)
    const results = (parsed.messages ?? []).filter((message) => message.role === "tool").length
    const call = parsed.tools?.length ? model.script[results] : undefined
    const chunk = (delta: unknown, finish: string | null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const usage = `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`
    const delta = call
      ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${results + 1}`, type: "function", function: { name: call.tool, arguments: JSON.stringify(call.arguments) } }] }
      : { role: "assistant", content: "Done." }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(`${chunk(delta, null)}${chunk({}, call ? "tool_calls" : "stop")}${usage}data: [DONE]\n\n`)
  }
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  ;(model as { baseUrl: string }).baseUrl = `http://127.0.0.1:${port}/v1`
  ;(model as { close: () => Promise<void> }).close = () => new Promise((resolve) => server.close(() => resolve()))
  return model
}

function json(response: ServerResponse, body: unknown) {
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body))
}
