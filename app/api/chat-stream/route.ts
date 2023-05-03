import { NextRequest } from "next/server";
import { requestStreamChat } from "../common-server";
import { findByDescriptionSimilarity } from "@/app/plugin/plugin-store";
import { invokePlugins } from "@/app/plugin/plugin-engine";

async function createStream(req: NextRequest) {
  const data = await req.json();
  // hack 一个用户名
  data.user = "小小";
  console.log("chat-stream", data);

  // 检查是否命中插件
  const lastPrompt = data.messages[data.messages.length - 1].content;
  const plugins = await findByDescriptionSimilarity(lastPrompt, ["todo"]);
  if (plugins.length > 0) {
    console.log(`命中插件${plugins}`);
    return invokePlugins(data, plugins);
  }

  const stream = new ReadableStream({
    async start(controller) {
      requestStreamChat(req.headers.get("path")!, data, controller);
    },
  });
  return stream;
}

export async function POST(req: NextRequest) {
  try {
    const stream = await createStream(req);
    return new Response(stream);
  } catch (error) {
    console.error("[Chat Stream]", error);
    return new Response(
      ["```json\n", JSON.stringify(error, null, "  "), "\n```"].join(""),
    );
  }
}

export const runtime = "edge";
