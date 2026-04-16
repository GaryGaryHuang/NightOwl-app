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
