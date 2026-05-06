export interface PromptBlock {
  readonly id: string;
  readonly content: string;
}

export function createPromptBlock(
  id: string,
  lines: readonly string[]
): PromptBlock {
  return {
    id,
    content: lines.join("\n")
  };
}

export function composePromptBlocks(blocks: readonly PromptBlock[]): string {
  return blocks.map((block) => block.content).join("\n\n");
}

export function getPromptBlockIds(blocks: readonly PromptBlock[]): readonly string[] {
  return blocks.map((block) => block.id);
}
