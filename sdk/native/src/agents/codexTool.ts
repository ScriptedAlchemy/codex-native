import { tool } from "@openai/agents";
import type { ToolExecutor, ToolExecutorResult } from "./toolRegistry";
import { registerCodexToolExecutor } from "./toolRegistry";

type BaseToolOptions = Parameters<typeof tool>[0];
type AgentTool = ReturnType<typeof tool>;

export type CodexToolOptions = BaseToolOptions & {
  codexExecute: (input: unknown) => Promise<unknown> | unknown;
};

type AgentTool = ReturnType<typeof tool>;

export function codexTool(options: CodexToolOptions): AgentTool {
  const { codexExecute, ...delegate } = options;
  const agentTool: AgentTool = tool(delegate as BaseToolOptions);
export function codexTool(options: CodexToolOptions): AgentTool {
  const { codexExecute, ...delegate } = options;
  const agentTool = tool(delegate as BaseToolOptions);

  const executor = createCodexExecutor(agentTool.name, codexExecute);
  registerCodexToolExecutor(agentTool.name, executor);

  return agentTool;
}

function createCodexExecutor(toolName: string, customExecutor: (input: unknown) => Promise<unknown> | unknown): ToolExecutor {
  return async ({ arguments: args }) => {
    const parsedArgs = args ?? {};
    try {
      const result = await customExecutor(parsedArgs);
      return result as ToolExecutorResult;
    } catch (error) {
      throw new Error(`Codex tool '${toolName}' failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
