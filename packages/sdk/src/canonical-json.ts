function encode(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("canonical JSON accepts only safe integer numbers");
    }
    return JSON.stringify(value);
  }

  if (typeof value === "bigint") {
    throw new TypeError(
      "canonical JSON requires unsigned integers as decimal strings",
    );
  }

  if (Array.isArray(value)) {
    return `[${value.map(encode).join(",")}]`;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical JSON accepts only plain objects");
    }

    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }

  throw new TypeError(
    "canonical JSON does not accept undefined, symbols, or functions",
  );
}

export function canonicalJson(value: unknown): string {
  return encode(value);
}
