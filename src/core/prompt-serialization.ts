/**
 * Helpers for host-owned prompt data blocks.
 *
 * XML-ish tags make prompt inputs easier for the model to distinguish, but the
 * tags are not a parser boundary. JSON payloads must still be encoded and
 * delimiter-like characters escaped by the harness before they are injected.
 */
export function stringifyForXmlishBlock(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[<>&]/gu, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      default:
        return char;
    }
  });
}

export function buildXmlishJsonBlock(
  tagName: string,
  value: unknown
): string[] {
  return [
    `<${tagName} format="json">`,
    stringifyForXmlishBlock(value),
    `</${tagName}>`
  ];
}
