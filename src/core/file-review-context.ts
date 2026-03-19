export interface FileReviewContextInput {
  filePath: string;
  noteFilePath: string;
  diffContent: string;
  baseRef: string;
  headRef: string;
}

export class FileReviewContext {
  readonly filePath: string;
  readonly noteFilePath: string;
  readonly diffContent: string;
  readonly baseRef: string;
  readonly headRef: string;
  readonly #sections = new Map<string, string>();

  constructor(input: FileReviewContextInput) {
    this.filePath = input.filePath;
    this.noteFilePath = input.noteFilePath;
    this.diffContent = input.diffContent;
    this.baseRef = input.baseRef;
    this.headRef = input.headRef;
  }

  setSection(sectionKey: string, content: string): void {
    this.#sections.set(sectionKey, content);
  }

  getSection(sectionKey: string): string | undefined {
    return this.#sections.get(sectionKey);
  }

  getSectionEntries(): Array<[string, string]> {
    return [...this.#sections.entries()];
  }
}
