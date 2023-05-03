import { requestStreamChat } from "../api/common-server";
import { db, Plugin } from "./plugin-store";
import { getCompeletion, checkHit } from "./util";
import { OpenApiParser } from "./openapi_parser";
import { OpenAPIV3 } from "openapi-types";

const encoder = new TextEncoder();

const PLUGIN_MARK_PHRASE = "尝试使用插件 - ";
export function invokePlugins(data: any, plugin_names: string[]) {
  // TODO 暂时支持一个插件
  const plugin_name = plugin_names[0];
  const plugin = db.get(plugin_name)!;
  return new ReadableStream({
    async start(controller) {
      function sendMessage(message: string) {
        controller.enqueue(encoder.encode(message));
      }
      try {
        sendMessage(
          `${PLUGIN_MARK_PHRASE} - ![${plugin_name}](/plugin-logos/${plugin_name}.png) ${plugin?.ai_plugin_json.name_for_human}\n\n`,
        );
        let ok = await confirmPlugin(
          plugin!,
          data.messages[data.messages.length - 1].content,
        );
        if (!ok) {
          sendMessage(
            `根据插件详细描述，发现不适合处理当前请求，转到大语言模型处理...\n`,
          );
          await requestStreamChat("v1/chat/completions", data, controller);
          return;
        }
        sendMessage(`根据插件描述，确认适合处理当前请求，开始处理...\n`);
        const api = await confirmPluginApi(
          plugin.api_yaml!,
          data.messages,
          data.user,
          sendMessage,
        );
        if (api === null) {
          sendMessage(`无法确定插件调用参数，转到大语言模型处理...\n`);
          await requestStreamChat("v1/chat/completions", data, controller);
          return;
        }
        sendMessage(`\n开始调用插件，操作ID: ${api.operation.operationId} , ${
          api.operation.summary ?? api.operation.description
        }
参数:
\`\`\`json
${JSON.stringify(api.params)}
\`\`\`
`);
      } catch (error) {
        console.error("插件调用失败...", error);
        sendMessage(`${error}\n`);
      } finally {
        controller.close();
      }
    },
  });
}

// 确认插件是否命中
async function confirmPlugin(
  plugin: Plugin,
  message: string,
): Promise<boolean> {
  const prompt = `Follow the user's instructions carefully and choose the correct operation.

插件描述：${plugin.description_for_model}

USER:${message}

根据插件描述，请告诉我这个插件是否适合处理USER请求，请用简洁语言回答，比如yes或者no。`;
  const positive_answers = ["yes", "是", "适合", "可以"];
  const negative_answers = ["no", "否", "不"];
  const completion = await getCompeletion(prompt, 10);
  console.log(`confirmPlugin, prompt:\n${prompt}\n回答:${completion}`);
  return (
    checkHit(completion, positive_answers) &&
    !checkHit(completion, negative_answers)
  );
}

// 确认插件接口与参数
async function confirmPluginApi(
  apiYaml: any,
  messages: any[],
  user: string,
  sendMessage: (message: string) => void,
): Promise<any> {
  console.log("confirmPluginApi", JSON.stringify(apiYaml), messages);
  const parser = new OpenApiParser(apiYaml, sendMessage);
  const operations = parser.getOperationObjects();
  sendMessage("寻找合适的接口...\n");
  const operation = await selectPluginApi(
    operations,
    messages[messages.length - 1].content,
  );
  if (operation === null) {
    return null;
  }
  console.log(
    `选中接口: ${operation.operationId} ${operation.summary} ${operation.description}`,
  );
  sendMessage("接口已找到，收集和检查参数...\n\n");
  const params = await confirmPluginApiParams(
    operation,
    messages,
    user,
    parser,
  );
  return { operation, params };
}

// 选择插件接口
async function selectPluginApi(
  operations: OpenAPIV3.OperationObject[],
  message: string,
): Promise<OpenAPIV3.OperationObject | null> {
  const operationIdList = [];
  let operationSummaryList = "";
  for (const operation of operations) {
    operationIdList.push(operation.operationId);
    operationSummaryList += `请求：${operation.summary} ${operation.description}\n操作：${operation.operationId}\n`;
  }
  const prompt = `Follow the user's instructions carefully and choose the correct operation.

判断一个请求的操作是${operationIdList.join("、")}还是other。

${operationSummaryList}
请求：${message}。
操作：`;
  const completion = await getCompeletion(prompt, 50);
  console.log(`selectPluginApi, prompt:\n${prompt}\n回答:${completion}\n`);
  // 选中第一个出现的结果，回答可能会有废话，废话会影响选择的正确性，比如“回答:deleteTodo请求：请帮我添加一个新的TODO操作：addTodo请求：请帮我查看清单中的所有TODO操”
  let min_pos = -1;
  let best_operation = null;
  for (const operation of operations) {
    const pos = completion.indexOf(operation.operationId!);
    if (pos !== -1 && (min_pos === -1 || pos < min_pos)) {
      min_pos = pos;
      best_operation = operation;
    }
  }
  return best_operation;
}

// 最大搜索上下文消息数量
const MAX_MESSAGE_SEARCH_COUNT = 4;
// 确认插件接口参数
async function confirmPluginApiParams(
  operation: OpenAPIV3.OperationObject,
  messages: any[],
  user: string,
  parser: OpenApiParser,
): Promise<any> {
  // 过滤无效的上文，最多找到上一个插件的输出(不包含），避免用户输入的内容过多，或者提取到旧的参数
  let validMessage = "";
  let pos = messages.length - 1;
  const end = Math.max(pos - MAX_MESSAGE_SEARCH_COUNT + 1, 0);
  for (; pos >= end; pos--) {
    const message = messages[pos];
    if (messages[pos].content.includes(PLUGIN_MARK_PHRASE)) {
      break;
    }
    validMessage += `${message.role}:${message.content}\n`;
  }
  // 依次从对话的上下文中依次获取参数,  不支持object, 仅支持基本类型 'boolean' | 'number' | 'string' | 'integer'
  // 以及基本类型数组 'boolean[]' | 'number[]' | 'string[]' | 'integer[]'
  return await parser.getPluginApiParams(operation, validMessage, user);
}
