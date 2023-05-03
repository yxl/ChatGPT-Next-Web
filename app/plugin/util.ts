import { requestChat } from "../api/common-server";

// 检查是否命中数组中的任意字符串
export function checkHit(message: string, array: string[]): boolean {
  for (const item of array) {
    if (message.toLocaleLowerCase().includes(item.toLocaleLowerCase())) {
      return true;
    }
  }
  return false;
}

export async function getCompeletion(
  prompt: string,
  max_tokens = 1000,
  model = "sage-1.0",
  temperature = 0.2,
  top_p = 0.75,
): Promise<string> {
  const res = await requestChat("v1/completions", {
    max_tokens,
    model,
    prompt,
    temperature,
    top_p,
    user: "system",
    stream: false,
  });
  if (res.status !== 200) {
    console.error("getCompeletion error", res);
    return "error";
  }
  const json = await res.json();
  return simplifyMessage(json.choices[0].text);
}

// 简化消息，去除空格、换行和标点符号，去除前后的引号和：号
// 测试用例：
//   "：“明天做项目复盘”" -> "明天做项目复盘"
export function simplifyMessage(message: string): string {
  return message
    .replace(/[\s\n\.,，。？！]/g, "")
    .replace(/^["“”:：]+/, "")
    .replace(/["“”:：]+$/, "");
}
