import type { Intent } from "../../discord/intent.schema.js";

// Checks that every key present in `expected` matches the corresponding value
// in `actual`. Recurses into nested objects. Ignores keys absent from expected.
export function matchesExpected(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];

  for (const [key, expectedVal] of Object.entries(expected)) {
    const actualVal = actual[key];

    if (
      expectedVal !== null &&
      typeof expectedVal === "object" &&
      !Array.isArray(expectedVal)
    ) {
      if (actualVal === null || typeof actualVal !== "object") {
        failures.push(`${key}: expected object, got ${JSON.stringify(actualVal)}`);
      } else {
        const nested = matchesExpected(
          actualVal as Record<string, unknown>,
          expectedVal as Record<string, unknown>
        );
        failures.push(...nested.failures.map((f) => `${key}.${f}`));
      }
    } else if (actualVal !== expectedVal) {
      failures.push(`${key}: expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)}`);
    }
  }

  return { pass: failures.length === 0, failures };
}

export type EvalResult = {
  message: string;
  schemaValid: boolean;
  correct: boolean;
  failures: string[];
  actual: Intent | null;
  error: string | null;
};
