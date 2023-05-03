import { requestChat } from "../api/common-server";
const similarity = require("compute-cosine-similarity");

class Plugin {
  constructor(
    public name_for_model: string,
    public description_for_model: string,
    public description_for_model_embedding: number[],
    public ai_plugin_json: any,
    public api_yaml: string,
  ) {}
}

export const db = new Map<string, Plugin>();

const PLUGIN_LIST = ["todo"];

const DEBUG = false;

export async function init() {
  for (let name of PLUGIN_LIST) {
    console.log(`load plugin ${name}...`);
    const json = await import(`./plugins/${name}/ai-plugin.json`);
    const yaml = await import(`./plugins/${name}/openapi.yaml`);
    const embedding = await getEmbedding(json.description_for_model);
    const plugin = new Plugin(
      name,
      json.description_for_model,
      embedding,
      json,
      yaml,
    );
    db.set(name, plugin);
    console.log(`load plugin ${name} success`, plugin);
  }
  if (DEBUG) {
    for (const prompt of [
      "显示待办事项清单。",
      "获取已规划的任务列表。",
      "非常感谢您选择我作为您的塔罗占卜师",
    ]) {
      console.log(
        prompt,
        await findByDescriptionSimilarity(prompt, PLUGIN_LIST),
      );
    }
  }
}

/**
 * 根据聊天的 prompt，返回最相似的插件
 * @param prompt 聊天的prompt
 * @param candidate_model_names 候选的插件名称列表
 * @param threshold 相似度阈值
 * @param limit
 * @returns
 */
export async function findByDescriptionSimilarity(
  prompt: string,
  candidate_model_names: string[],
  threshold: number = 0.5,
  limit: number = 10,
): Promise<string[]> {
  const prompt_embedding = await getEmbedding(prompt);
  const distances = candidate_model_names.map((name) => {
    const plugin = db.get(name);
    return {
      name,
      distance: similarity(
        plugin!.description_for_model_embedding,
        prompt_embedding,
      ),
    };
  });
  const result = distances
    .sort((a, b) => b.distance - a.distance)
    .filter((distance) => distance.distance > threshold)
    .map((distance) => distance.name);
  if (result.length > limit) {
    result.splice(limit);
  }
  return result;
}

async function getEmbedding(text: string): Promise<number[]> {
  const embeddingRes = await requestChat("v1/embeddings", {
    model: "text-embedding-MiniLM-L12",
    input: text,
    user: "system",
  });
  if (embeddingRes.status !== 200) {
    console.error("getEmbedding error", embeddingRes);
    return [];
  }
  const res = await embeddingRes.json();
  return res.data[0].embedding;
}
