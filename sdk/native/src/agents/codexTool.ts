import { tool } from "@openai/agents";
import type { ToolExecutor, ToolExecutorResult } from "./toolRegistry";
import { registerCodexToolExecutor } from "./toolRegistry";

type BaseToolOptions = Parameters<typeof tool>[0];
type AgentTool = ReturnType<typeof tool>;

export type CodexToolOptions = BaseToolOptions & {
  codexExecute?: (input: unknown) => Promise<unknown> | unknown;
};

export function codexTool(options: CodexToolOptions): AgentTool {
  const { codexExecute, ...delegate } = options;
  const agentTool = tool(delegate as BaseToolOptions);

  // Use codexExecute if provided, otherwise use execute from the tool options
  const executeFn = codexExecute ?? (delegate as BaseToolOptions).execute;
  const executor = createCodexExecutor(agentTool.name, executeFn);
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
