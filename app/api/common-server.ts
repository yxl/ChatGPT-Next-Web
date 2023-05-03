import { getServerSideConfig } from "../config/server";
import { createParser } from "eventsource-parser";

const OPENAI_URL = "api.openai.com";
const DEFAULT_PROTOCOL = "https";
const PROTOCOL = process.env.PROTOCOL ?? DEFAULT_PROTOCOL;
const BASE_URL = process.env.BASE_URL!;
const BASE_URL_OPENAI = process.env.BASE_URL_OPENAI ?? OPENAI_URL;

const serverConfig = getServerSideConfig();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function requestStreamChat(
  path: string,
  data: any,
  controller: ReadableStreamDefaultController<any>,
) {
  function onParse(event: any) {
    if (event.type === "event") {
      const data = event.data;
      // https://beta.openai.com/docs/api-reference/completions/create#completions/create-stream
      if (data === "[DONE]") {
        controller.close();
        return;
      }
      try {
        const json = JSON.parse(data);
        const text = json.choices[0].delta.content;
        const queue = encoder.encode(text);
        controller.enqueue(queue);
      } catch (e) {
        controller.error(e);
      }
    }
  }
  const res = await requestChat(path, data);
  const parser = createParser(onParse);
  for await (const chunk of res.body as any) {
    parser.feed(decoder.decode(chunk, { stream: true }));
  }
}

export async function requestChat(path: string, data: any) {
  const apiKey = serverConfig.apiKey;
  const model = data.model ?? "sage-1.0";
  let baseUrl = model.startsWith("gpt") ? BASE_URL_OPENAI : BASE_URL;
  if (!baseUrl.startsWith("http")) {
    baseUrl = `${PROTOCOL}://${baseUrl}`;
  }

  if (process.env.OPENAI_ORG_ID) {
    console.log("[Org ID]", process.env.OPENAI_ORG_ID);
  }

  return fetch(`${baseUrl}/${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(process.env.OPENAI_ORG_ID && {
        "OpenAI-Organization": process.env.OPENAI_ORG_ID,
      }),
    },
    method: "POST",
    body: JSON.stringify(data),
  });
}
