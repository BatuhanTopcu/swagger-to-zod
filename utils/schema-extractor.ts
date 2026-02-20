const JSON_SELECTORS = [
  ".model-example",
  ".example-value",
  ".highlight-code",
  ".microlight",
  "pre code",
  "pre",
  "code.language-json",
  "code",
];

const COMMON_PATH_PREFIXES = ["/api", "/v1", "/v2", "/api/v1", "/api/v2"];

const STATUS_CODE_PATTERN = /\b(1\d{2}|2\d{2}|3\d{2}|4\d{2}|5\d{2}|default)\b/i;

let cachedSpec: Record<string, unknown> | null = null;

export const setSpecFromMainWorld = (spec: Record<string, unknown>): void => {
  cachedSpec = spec;
};

export const getOpenAPISpec = (): Record<string, unknown> | null => {
  return cachedSpec;
};

export const extractSchemaFromElement = (element: Element): Record<string, unknown> | null => {
  const specSchema = extractSchemaFromSpec(element);
  if (specSchema) {
    return specSchema;
  }

  for (const selector of JSON_SELECTORS) {
    const el = element.querySelector(selector);
    if (el) {
      const json = parseJsonFromElement(el);
      if (json) {
        const inferred = inferSchemaFromValue(json);
        return augmentSchemaWithDomRequired(inferred, element);
      }
    }
  }

  for (const selector of JSON_SELECTORS) {
    const elements = element.querySelectorAll(selector);
    for (const el of Array.from(elements)) {
      const json = parseJsonFromElement(el);
      if (json) {
        const inferred = inferSchemaFromValue(json);
        return augmentSchemaWithDomRequired(inferred, element);
      }
    }
  }

  const text = element.textContent?.trim() || "";
  if (text && (text.startsWith("{") || text.startsWith("["))) {
    try {
      const json = JSON.parse(text);
      return inferSchemaFromValue(json);
    } catch {}
  }

  return null;
};

const extractSchemaFromSpec = (element: Element): Record<string, unknown> | null => {
  const spec = getOpenAPISpec();
  if (!spec) return null;

  const inResponseContext = !!element.closest(".response, .responses-wrapper");

  if (inResponseContext) {
    try {
      const responseSchema = findResponseSchemaFromElement(element, spec);
      if (responseSchema) return responseSchema;
    } catch {}
  }

  try {
    const requestSchema = findRequestBodySchemaFromElement(element, spec);
    if (requestSchema) return requestSchema;
  } catch {}

  if (!inResponseContext) {
    try {
      const responseSchema = findResponseSchemaFromElement(element, spec);
      if (responseSchema) return responseSchema;
    } catch {}
  }

  return null;
};

interface MethodAndPath {
  method: string;
  path: string;
}

const extractMethodAndPath = (opblock: Element): MethodAndPath | null => {
  const methodEl = opblock.querySelector(".opblock-summary-method");
  const pathEl = opblock.querySelector(".opblock-summary-path, [data-path]");
  if (!methodEl || !pathEl) return null;

  const method = methodEl.textContent?.toLowerCase().trim();
  const path = pathEl.textContent?.trim() || pathEl.getAttribute("data-path");
  if (!method || !path) return null;

  return { method, path };
};

const extractResponseCode = (responseWrapper: Element | null): string => {
  if (!responseWrapper) return "200";

  const dataCode = responseWrapper.getAttribute("data-code");
  if (dataCode) return dataCode;

  const statusEl = responseWrapper.querySelector(".response-col_status");
  if (statusEl) {
    const statusText = statusEl.textContent?.trim();
    if (statusText) return statusText;
  }

  const rowMatch = responseWrapper.textContent?.match(STATUS_CODE_PATTERN);
  if (rowMatch) return rowMatch[0].toLowerCase();

  const responseHeader = responseWrapper.querySelector('.response-header, [class*="response"]');
  if (responseHeader) {
    const headerMatch = responseHeader.textContent?.match(STATUS_CODE_PATTERN);
    if (headerMatch) return headerMatch[0].toLowerCase();
  }

  const firstCell = responseWrapper.querySelector(
    "td:first-child, th:first-child, .response-col_status",
  );
  if (firstCell) {
    const cellMatch = firstCell.textContent?.trim()?.match(STATUS_CODE_PATTERN);
    if (cellMatch) return cellMatch[0].toLowerCase();
  }

  return "200";
};

const findOperationInSpec = (
  paths: Record<string, Record<string, unknown>>,
  method: string,
  path: string,
): Record<string, unknown> | null => {
  let operation = paths[path]?.[method] as Record<string, unknown> | undefined;
  if (operation) return operation;

  const altPath = path.endsWith("/") ? path.slice(0, -1) : path + "/";
  operation = paths[altPath]?.[method] as Record<string, unknown> | undefined;
  if (operation) return operation;

  for (const prefix of COMMON_PATH_PREFIXES) {
    if (path.startsWith(prefix)) {
      const strippedPath = path.slice(prefix.length);
      operation = (paths[strippedPath]?.[method] || paths[prefix + strippedPath]?.[method]) as
        | Record<string, unknown>
        | undefined;
      if (operation) return operation;
    }
  }

  return null;
};

const extractSchemaFromOperation = (
  operation: Record<string, unknown>,
  responseCode: string,
  spec: Record<string, unknown>,
): Record<string, unknown> | null => {
  const responses = operation.responses as Record<string, Record<string, unknown>> | undefined;
  if (!responses) return null;

  let response = responses[responseCode];

  if (!response) {
    const normalizedCode = responseCode.toLowerCase();
    for (const [code, resp] of Object.entries(responses)) {
      if (code.toLowerCase() === normalizedCode) {
        response = resp as Record<string, unknown>;
        break;
      }
    }
  }

  if (!response && responseCode.toLowerCase() !== "default") {
    response = responses["default"];
  }

  if (!response) return null;

  const content = response.content as Record<string, Record<string, unknown>> | undefined;
  if (content) {
    const jsonContent = content["application/json"] || content["*/*"] || Object.values(content)[0];
    if (jsonContent?.schema) {
      return resolveRefs(jsonContent.schema as Record<string, unknown>, spec);
    }
  }

  if (response.schema) {
    return resolveRefs(response.schema as Record<string, unknown>, spec);
  }

  return null;
};

const extractRequestBodySchemaFromOperation = (
  operation: Record<string, unknown>,
  spec: Record<string, unknown>,
): Record<string, unknown> | null => {
  const rawRequestBody = operation.requestBody as Record<string, unknown> | undefined;
  const requestBody = resolveSchemaObjectRef(rawRequestBody, spec);

  if (requestBody) {
    const content = requestBody.content as Record<string, Record<string, unknown>> | undefined;
    if (content) {
      const jsonEntry = Object.entries(content).find(([mediaType]) =>
        mediaType.toLowerCase().includes("json"),
      );
      const jsonContent =
        jsonEntry?.[1] ||
        content["application/json"] ||
        content["*/*"] ||
        Object.values(content)[0];

      if (jsonContent?.schema) {
        return resolveRefs(jsonContent.schema as Record<string, unknown>, spec);
      }
    }
  }

  const parameters = operation.parameters as Array<Record<string, unknown>> | undefined;
  if (!parameters) return null;

  for (const param of parameters) {
    const resolvedParam = resolveSchemaObjectRef(param, spec);
    if (resolvedParam?.in === "body" && resolvedParam.schema) {
      return resolveRefs(resolvedParam.schema as Record<string, unknown>, spec);
    }
  }

  return null;
};

const findResponseSchemaFromElement = (
  element: Element,
  spec: Record<string, unknown>,
): Record<string, unknown> | null => {
  const opblock = element.closest(".opblock");
  if (!opblock) return null;

  const methodAndPath = extractMethodAndPath(opblock);
  if (!methodAndPath) return null;

  const responseWrapper = element.closest(".response");
  const responseCode = extractResponseCode(responseWrapper);

  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return null;

  const operation = findOperationInSpec(paths, methodAndPath.method, methodAndPath.path);
  if (!operation) return null;

  return extractSchemaFromOperation(operation, responseCode, spec);
};

const findRequestBodySchemaFromElement = (
  element: Element,
  spec: Record<string, unknown>,
): Record<string, unknown> | null => {
  if (element.closest(".response, .responses-wrapper")) return null;

  const opblock = element.closest(".opblock");
  if (!opblock) return null;

  const methodAndPath = extractMethodAndPath(opblock);
  if (!methodAndPath) return null;

  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
  if (!paths) return null;

  const operation = findOperationInSpec(paths, methodAndPath.method, methodAndPath.path);
  if (!operation) return null;

  return extractRequestBodySchemaFromOperation(operation, spec);
};

const parseJsonFromElement = (element: Element): unknown | null => {
  try {
    const text = element.textContent?.trim();
    if (!text) return null;

    try {
      if (text.startsWith("{") || text.startsWith("[")) {
        return JSON.parse(text);
      }
    } catch {}

    const jsonCandidate = extractBalancedJson(text);
    if (jsonCandidate) {
      return JSON.parse(jsonCandidate);
    }
  } catch {}
  return null;
};

export const extractBalancedJson = (text: string): string | null => {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");

  if (startObj === -1 && startArr === -1) return null;

  let start = -1;
  let openChar = "";
  let closeChar = "";

  if (startObj !== -1 && (startArr === -1 || startObj < startArr)) {
    start = startObj;
    openChar = "{";
    closeChar = "}";
  } else {
    start = startArr;
    openChar = "[";
    closeChar = "]";
  }

  let balance = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === openChar) {
        balance++;
      } else if (char === closeChar) {
        balance--;
        if (balance === 0) {
          return text.substring(start, i + 1);
        }
      }
    }
  }

  return null;
};

export const inferSchemaFromValue = (value: unknown): Record<string, unknown> => {
  if (value === null) return { type: "null" };

  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length > 0 ? inferSchemaFromValue(value[0]) : {},
    };
  }

  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        properties[key] = inferSchemaFromValue(val);
        if (val !== null && val !== undefined) required.push(key);
      }

      return { type: "object", properties, required };
    }
    default:
      return {};
  }
};

const augmentSchemaWithDomRequired = (
  schema: Record<string, unknown>,
  element: Element,
): Record<string, unknown> => {
  if (schema.type !== "object" || !schema.properties) return schema;

  const result = { ...schema };
  const properties = result.properties as Record<string, Record<string, unknown>>;
  let required = (result.required as string[]) || [];

  const optionalKeys = new Set<string>();

  for (const key of Object.keys(properties)) {
    const propNameElements = Array.from(element.querySelectorAll(".prop-name, .property, .key"));

    let foundRow: Element | null = null;
    for (const el of propNameElements) {
      if (el.textContent?.trim() === key) {
        foundRow = el.closest("tr, .prop-row, .property-row") || el.parentElement;
        break;
      }
    }

    if (foundRow) {
      const rowText = foundRow.textContent || "";
      const isRequired = rowText.includes("*") || !!foundRow.querySelector(".required");
      if (!isRequired) {
        optionalKeys.add(key);
      }
    }

    if (properties[key].type === "object") {
      properties[key] = augmentSchemaWithDomRequired(properties[key], element);
    } else if (
      properties[key].type === "array" &&
      (properties[key].items as any)?.type === "object"
    ) {
      properties[key].items = augmentSchemaWithDomRequired(properties[key].items as any, element);
    }
  }

  if (optionalKeys.size > 0) {
    required = required.filter((k) => !optionalKeys.has(k));
  }

  if (required.length > 0) {
    result.required = required;
  } else {
    delete result.required;
  }

  return result;
};

export const resolveRefs = (
  schema: Record<string, unknown>,
  spec: Record<string, unknown>,
): Record<string, unknown> => {
  const resolved = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  return resolveRefsRecursive(resolved, spec, new Set());
};

const resolveRefsRecursive = (
  obj: Record<string, unknown>,
  spec: Record<string, unknown>,
  visited: Set<string>,
): Record<string, unknown> => {
  if (typeof obj !== "object" || obj === null) return obj;

  if ("$ref" in obj && typeof obj["$ref"] === "string") {
    const refPath = obj["$ref"] as string;
    if (visited.has(refPath)) return obj;
    visited.add(refPath);

    const resolved = resolveRefPath(refPath, spec);
    if (resolved) return resolveRefsRecursive({ ...resolved }, spec, visited);
  }

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        obj[key] = value.map((item) =>
          typeof item === "object" && item !== null
            ? resolveRefsRecursive(item as Record<string, unknown>, spec, visited)
            : item,
        );
      } else {
        obj[key] = resolveRefsRecursive(value as Record<string, unknown>, spec, visited);
      }
    }
  }

  return obj;
};

const resolveRefPath = (
  refPath: string,
  spec: Record<string, unknown>,
): Record<string, unknown> | null => {
  if (!refPath.startsWith("#/")) return null;

  const path = refPath.slice(2).split("/");
  let current: unknown = spec;

  for (const segment of path) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === "object" && current !== null
    ? (current as Record<string, unknown>)
    : null;
};

const resolveSchemaObjectRef = (
  obj: Record<string, unknown> | undefined,
  spec: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  if (!obj) return undefined;
  if (typeof obj.$ref !== "string") return obj;
  return resolveRefPath(obj.$ref, spec) || obj;
};
