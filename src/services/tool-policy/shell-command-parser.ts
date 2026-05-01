/**
 * Core quote-aware splitter. Iterates over `command` and calls `isDelimiter`
 * at every top-level character (i.e. not inside quotes and not being escaped).
 *
 * `isDelimiter` return value semantics:
 *   - `0`          : not a delimiter; append char to currentSegment
 *   - `n > 0`      : delimiter consuming n chars; commit currentSegment, reset,
 *                    advance the loop index by `n - 1` to skip already-consumed chars
 *   - `undefined`  : illegal character in current context; return `undefined` immediately
 */
function splitOnTopLevelDelimiter(
  command: string,
  isDelimiter: (char: string, nextChar: string | undefined) => number | undefined
): string[] | undefined {
  const segments: string[] = [];
  let currentSegment = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaping) {
      currentSegment += char;
      escaping = false;
      continue;
    }

    if (inSingleQuote) {
      currentSegment += char;

      if (char === "'") {
        inSingleQuote = false;
      }

      continue;
    }

    if (char === "\\") {
      currentSegment += char;
      escaping = true;
      continue;
    }

    if (inDoubleQuote) {
      currentSegment += char;

      if (char === '"') {
        inDoubleQuote = false;
      }

      continue;
    }

    if (char === "'") {
      currentSegment += char;
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      currentSegment += char;
      inDoubleQuote = true;
      continue;
    }

    const consumed = isDelimiter(char, command[i + 1]);

    if (consumed === undefined) {
      return undefined;
    }

    if (consumed > 0) {
      segments.push(currentSegment);
      currentSegment = "";
      i += consumed - 1;
      continue;
    }

    currentSegment += char;
  }

  if (escaping || inSingleQuote || inDoubleQuote) {
    return undefined;
  }

  segments.push(currentSegment);

  return segments;
}

export function splitTopLevelSequenceSegments(command: string): string[] | undefined {
  return splitOnTopLevelDelimiter(command, (char, nextChar) => {
    if (char === ";") {
      return 1;
    }

    if (char === "&") {
      return nextChar === "&" ? 2 : undefined;
    }

    return 0;
  });
}

export function splitTopLevelPipelineSegments(command: string): string[] | undefined {
  return splitOnTopLevelDelimiter(command, (char, nextChar) => {
    if (char === "|") {
      return nextChar === "|" ? undefined : 1;
    }

    return 0;
  });
}

export function containsTopLevelRedirection(command: string): boolean | undefined {
  // Reuse the single quote-aware FSM to detect top-level '<' or '>' characters.
  // If the command has unclosed quotes, splitOnTopLevelDelimiter returns undefined,
  // which maps to our undefined return (ambiguous). If a redirection char is found
  // the delimiter callback returns undefined to abort the split early, which also
  // yields undefined from the splitter — but we set a flag to distinguish the two.
  let redirectionFound = false;

  const result = splitOnTopLevelDelimiter(command, (char) => {
    if (char === "<" || char === ">") {
      redirectionFound = true;
      // Abort the split — we found what we were looking for.
      return undefined;
    }

    return 0;
  });

  if (redirectionFound) {
    return true;
  }

  // result === undefined means unclosed quotes (ambiguous input).
  if (result === undefined) {
    return undefined;
  }

  return false;
}

export function containsShellExpansion(command: string): boolean | undefined {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;
  let atWordStart = true;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaping) {
      escaping = false;
      atWordStart = false;
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      }

      atWordStart = false;
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
        continue;
      }

      if (char === "\\") {
        const nextChar = command[i + 1];

        if (isDoubleQuoteEscapedChar(nextChar)) {
          escaping = true;
        }

        continue;
      }

      if (char === "$" && startsShellExpansion(command[i + 1])) {
        return true;
      }

      atWordStart = false;
      continue;
    }

    if (/\s/u.test(char)) {
      atWordStart = true;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      atWordStart = false;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      atWordStart = false;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      atWordStart = false;
      continue;
    }

    if (char === "$" && startsShellExpansion(command[i + 1])) {
      return true;
    }

    if (char === "~" && atWordStart) {
      return true;
    }

    if (char === "*" || char === "?" || char === "[") {
      return true;
    }

    if (char === "{" && startsBraceExpansion(command, i)) {
      return true;
    }

    atWordStart = false;
  }

  if (escaping || inSingleQuote || inDoubleQuote) {
    return undefined;
  }

  return false;
}

export function splitShellCommandWords(command: string): string[] | undefined {
  const words: string[] = [];
  let currentWord = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;
  let wordStarted = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaping) {
      currentWord += char;
      escaping = false;
      wordStarted = true;
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      } else {
        currentWord += char;
      }

      wordStarted = true;
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
        wordStarted = true;
        continue;
      }

      if (char === "\\") {
        const nextChar = command[i + 1];

        if (isDoubleQuoteEscapedChar(nextChar)) {
          escaping = true;
        } else {
          currentWord += char;
        }

        wordStarted = true;
        continue;
      }

      currentWord += char;
      wordStarted = true;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      wordStarted = true;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      wordStarted = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      wordStarted = true;
      continue;
    }

    if (/\s/u.test(char)) {
      if (wordStarted) {
        words.push(currentWord);
        currentWord = "";
        wordStarted = false;
      }

      continue;
    }

    currentWord += char;
    wordStarted = true;
  }

  if (escaping || inSingleQuote || inDoubleQuote) {
    return undefined;
  }

  if (wordStarted) {
    words.push(currentWord);
  }

  return words;
}

function isDoubleQuoteEscapedChar(char: string | undefined): boolean {
  return (
    char === "$" ||
    char === "`" ||
    char === '"' ||
    char === "\\" ||
    char === "\n"
  );
}

function startsBraceExpansion(command: string, startIndex: number): boolean {
  let escaping = false;
  let hasComma = false;
  let hasSequence = false;

  for (let i = startIndex + 1; i < command.length; i++) {
    const char = command[i];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === "}") {
      return hasComma || hasSequence;
    }

    if (char === ",") {
      hasComma = true;
      continue;
    }

    if (char === "." && command[i + 1] === ".") {
      hasSequence = true;
    }
  }

  return false;
}

function startsShellExpansion(char: string | undefined): boolean {
  if (char === undefined) {
    return false;
  }

  return (
    /[A-Za-z0-9_]/u.test(char) ||
    ["{", "(", "[", "'", '"', "#", "?", "!", "$", "*", "@", "-"].includes(char)
  );
}
