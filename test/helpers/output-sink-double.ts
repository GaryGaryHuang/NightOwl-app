import type { ReviewOutputBootstrapAndPublisher } from "../../src/providers/review-output-sink.ts";

export function defineOutputSinkDouble(
  sink: ReviewOutputBootstrapAndPublisher
): ReviewOutputBootstrapAndPublisher {
  return sink;
}
