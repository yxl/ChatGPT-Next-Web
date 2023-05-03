import { getServerSideConfig } from "../config/server";

const OPENAI_URL = "api.openai.com";
const DEFAULT_PROTOCOL = "https";
const PROTOCOL = process.env.PROTOCOL ?? DEFAULT_PROTOCOL;
const BASE_URL = process.env.BASE_URL!;
const BASE_URL_OPENAI = process.env.BASE_URL_OPENAI ?? OPENAI_URL;

const serverConfig = getServerSideConfig();

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
