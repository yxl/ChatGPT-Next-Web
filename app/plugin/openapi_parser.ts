import { OpenAPIV3 } from "openapi-types";
import { getCompeletion, checkHit, simplifyMessage } from "./util";

export class OpenApiParser {
  constructor(
    public api_yaml: any,
    private sendMessage: (message: string) => void,
  ) {}

  // 获取所有的OperationObject(即API接口对象)
  getOperationObjects(): OpenAPIV3.OperationObject[] {
    const paths = this.api_yaml.paths;
    const operations: OpenAPIV3.OperationObject[] = [];
    for (const path in paths) {
      for (const method in paths[path]) {
        const operation = paths[path][method];
        // 处理一下summary和description，避免undefined和null
        operation.summary = simplifyMessage(operation.summary || "");
        operation.description = simplifyMessage(operation.description || "");
        operations.push(paths[path][method]);
        // 处理一下arguments, 避免undefined和null
        if (operation.parameters) {
          for (const parameter of operation.parameters) {
            parameter.description = simplifyMessage(
              parameter.description || "",
            );
            parameter.summary = simplifyMessage(parameter.summary || "");
          }
        }
      }
    }
    return operations;
  }

  static TYPE_PROMPT_MAP: any = {
    boolean: "请用简洁语言回答，比如yes或者no。",
    number: "仅回答找出的数字，例如：0.1。",
    integer: "仅回答找出的数字，例如：1。",
    string: "仅回答找出的文本。",
    // 这个使用场景不多，未进行测试
    "boolean[]": "请用简洁语言回答，比如yes或者no。",
    "number[]": "仅回答找出的数字列表，以空格分隔，例如：1.1 2.2 3",
    "integer[]": "仅回答找出的数字列表，以空格分隔，例如：1 2 3",
    "string[]": "仅回答找出的文本, 以空格分隔",
  };

  /**
   * 获取基本类型的抓取prompt, 类型包括 'boolean' | 'number' | 'string' | 'integer' | 'boolean[]' | 'number[]' | 'string[]' | 'integer[]'
   */
  getParameterTypePrompt(type: string): string {
    return OpenApiParser.TYPE_PROMPT_MAP[type] || "请用简洁语言回答";
  }

  /**
   * 解析基本类抓取的结构，类型包括 'boolean' | 'number' | 'string' | 'integer' | 'boolean[]' | 'number[]' | 'string[]' | 'integer[]'
   */
  parseParameterTypeResult(
    parameter_name: string,
    type: string,
    value: string,
  ): any {
    // 去除返回结果中包含的参数名, 通常为以下几种情况
    // 1.[参数名]:[值]
    // 2. [参数名]是[值]
    if (value && value.includes(parameter_name)) {
      // 处理 [参数名]:[值] 的情况
      for (const separator of [":", "："]) {
        if (value.includes(parameter_name + separator)) {
          value = value.split(separator)[1];
          break;
        }
      }
      // 处理 [参数名]是[值] 的情况，只保留“是”之后的内容
      const pos = value.indexOf(parameter_name) + parameter_name.length;
      if (value.indexOf("是", pos) < pos + 4) {
        value = value.substring(value.indexOf("是", pos) + 1);
      }
    }
    // TODO 支持数组类型参数
    switch (type) {
      case "boolean": {
        return checkHit(value, ["是", "yes"]);
      }
      case "number": {
        // 测试用例：
        // "£1,739.12" -> 1739.12
        // "你好£1,739.12" -> 1739.12
        // "你好£1,739.12你好121" -> 1739.12
        // "1,000,000.01" -> 1000000.01
        // "今天星期几" -> null
        // "1e3" -> 1000
        return (
          parseFloat(value.replace(/^[^\d\.]*/g, "").replaceAll(",", "")) ||
          null
        );
      }
      case "string": {
        return simplifyMessage(value);
      }
      case "integer": {
        // 测试用例：
        //  "foo3bar5" -> 3
        //  "some text 2你好2323" -> 2
        //  "adbc" -> null
        //  "你好2,020" -> 2020
        //  "1e3" -> 1000
        // 匹配第一个数字
        return (
          parseFloat(value.replace(/^[^\d\.]*/g, "").replaceAll(",", "")) | 0 ||
          null
        );
      }
    }
  }

  // 根据$ref获取schema对象
  getSchemaObject($ref: string): OpenAPIV3.SchemaObject {
    const ref = $ref.replace("#/components/schemas/", "");
    return this.api_yaml.components.schemas[ref];
  }

  // 获取插件接口参数
  async getPluginApiParams(
    operation: OpenAPIV3.OperationObject,
    context: string,
    user: string,
  ): Promise<any> {
    // 依次从对话的上下文中依次获取参数,  不支持object, 仅支持基本类型 'boolean' | 'number' | 'string' | 'integer'
    // 以及基本类型数组 'boolean[]' | 'number[]' | 'string[]' | 'integer[]'
    const input_parameters: any = {};
    if (operation.parameters) {
      for (let parameter of operation.parameters) {
        parameter = parameter as OpenAPIV3.ParameterObject;
        const description = parameter.description ?? parameter.name;
        if (!parameter.name) {
          console.warn(`不支持引用型参数:${description}，请修改接口定义`);
          throw new Error(`不支持引用型参数:${description}，请修改接口定义 `);
        }
        let schemaObject = parameter.schema!;
        if (!schemaObject.type) {
          schemaObject = parser.getSchemaObject(schemaObject.$ref!);
        }
        schemaObject.description = parameter.description;
        schemaObject.required = parameter.required;
        this.sendMessage(`* 获取参数：${description}，`);
        const value = await this.getSchemaValueFromContext(
          parameter.name,
          schemaObject,
          context,
          user,
        );
        input_parameters[parameter.name] = value[parameter.name];
        this.sendMessage(`参数值：${value[parameter.name]}\n`);
      }
    }
    let post_body_content: any = {};
    // 提取请求体参数
    if (operation.requestBody) {
      const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
      if (requestBody.content) {
        const content = requestBody.content;
        if (!content["application/json"]) {
          throw new Error(`请求体类型仅支持application/json，请修改接口定义`);
        }
        post_body_content = await this.getSchemaValueFromContext(
          "",
          content["application/json"].schema,
          context,
          user,
        );
      }
    }
    return {
      input_parameters,
      post_body_content,
    };
  }

  // 支持抽取的参数类型
  static SURPPORTED_SCHEMA_TYPES = [
    "boolean",
    "number",
    "string",
    "integer",
    "boolean[]",
    "number[]",
    "string[]",
    "integer[]",
  ];

  async getSchemaValueFromContext(
    name: string,
    schemaObject: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
    context: string,
    user: string,
  ): Promise<any> {
    if (!schemaObject.type) {
      schemaObject = this.getSchemaObject(
        schemaObject.$ref,
      ) as OpenAPIV3.SchemaObject;
    }
    const post_body_content: any = {};
    if (schemaObject.type === "object") {
      for (const [key, value] of Object.entries(
        schemaObject.properties ?? {},
      )) {
        post_body_content[key] = await this.getSchemaValueFromContext(
          key,
          value,
          context,
          user,
        );
      }
      return post_body_content;
    }
    // 用户名参数直接从用户信息中获取
    if (isUserName(name, schemaObject)) {
      console.log(`参数${name}为用户名，直接从用户信息中获取`);
      post_body_content[name] = user;
      return post_body_content;
    }
    let parameter_type = schemaObject.type || "";
    if (parameter_type === "array") {
      parameter_type = `${schemaObject.schema.items?.type}[]`;
    }
    const description = simplifyMessage(
      schemaObject.description ?? schemaObject.title ?? name,
    );
    if (!OpenApiParser.SURPPORTED_SCHEMA_TYPES.includes(parameter_type)) {
      if (schemaObject.required) {
        console.warn(
          `不支持的参数类型${parameter_type}，请修改接口定义, 参数${description}`,
        );
        throw new Error(
          `不支持的参数类型${parameter_type}，请修改接口定义, 参数${description}`,
        );
      }
    }
    this.sendMessage(`* 获取参数：${description}，`);
    const value = await this.getParameterValueFromContext(
      description!,
      parameter_type,
      context,
    );
    if (!value && schemaObject.required) {
      throw new Error(`请输入${description}`);
    }
    this.sendMessage(`参数值：${value}\n`);
    return value;
  }

  // 从上下聊天记录提取特定类型的参数的值
  async getParameterValueFromContext(
    parameter_name: string,
    parameter_type: string,
    context: string,
  ): Promise<any> {
    const type_prompt = this.getParameterTypePrompt(parameter_type);
    const prompt = `Follow the user's instructions carefully and choose the correct operation.
    ${context}。从上面对话中找出“${parameter_name}”，${type_prompt}。`;
    const completion = await getCompeletion(prompt, 200);
    if (completion.includes("error")) {
      console.error(`提取参数${parameter_name}失败，请重试`);
      throw new Error(`提取参数${parameter_name}失败，请重试`);
    }
    console.log(
      `参数抽取，${context}, 抽取：${parameter_name}, 结果: ${completion}`,
    );
    const result = this.parseParameterTypeResult(
      parameter_name,
      parameter_type,
      simplifyMessage(completion),
    );
    console.log(
      `参数处理结果, 处理前：${completion}, 处理后：${result}, 类型: ${parameter_type}`,
    );
    return result;
  }
}

const USER_NAME_PATTERN = ["user", "username", "user name", "用户名", "用户"];
function isUserName(
  name: string,
  schemaObject: OpenAPIV3.SchemaObject,
): boolean {
  const names = [name];
  if (schemaObject.description) {
    names.push(schemaObject.description);
  }
  if (schemaObject.title) {
    names.push(schemaObject.title);
  }
  for (const n of names) {
    if (checkHit(n.toLocaleLowerCase(), USER_NAME_PATTERN)) {
      return true;
    }
  }
  return false;
}
