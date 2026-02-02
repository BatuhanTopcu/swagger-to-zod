import jsonSchemaToZod from "json-schema-to-zod";
import parserEstree from "prettier/plugins/estree";
import parserTypescript from "prettier/plugins/typescript";
import * as prettier from "prettier/standalone";

interface ExtractedSchemaInfo {
  schema: Record<string, unknown>;
  candidateNames: Set<string>;
  finalName?: string;
}

const toLowerCamelCase = (str: string): string => {
  if (!str) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
};

const capitalize = (str: string): string => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

const canonicalize = (obj: unknown): string => {
  if (typeof obj !== "object" || obj === null) {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map((key) => {
    return JSON.stringify(key) + ":" + canonicalize((obj as Record<string, unknown>)[key]);
  });
  return "{" + parts.join(",") + "}";
};

const formatCode = async (code: string): Promise<string> => {
  try {
    return await prettier.format(code, {
      parser: "typescript",
      plugins: [parserTypescript, parserEstree],
      printWidth: 80,
      tabWidth: 2,
    });
  } catch (e) {
    console.error("Prettier formatting failed:", e);
    return code;
  }
};

export const jsonSchemaToZodWithExtraction = async (
  schema: Record<string, unknown>,
  mainName: string,
): Promise<string> => {
  const extracted = new Map<string, ExtractedSchemaInfo>();

  const processedSchema = extractNestedSchemas(schema, "", extracted, 0);

  const hashToNameMap = new Map<string, string>();

  for (const [hash, info] of extracted.entries()) {
    const finalName = generateNameFromCandidates(info.candidateNames);
    info.finalName = finalName;
    hashToNameMap.set(hash, finalName);
  }

  const parts: string[] = ['import { z } from "zod";'];

  for (const [hash, info] of extracted.entries()) {
    if (!info.finalName) continue;
    parts.push(convertToZodCode(info.schema, info.finalName, hashToNameMap));
  }

  parts.push(convertToZodCode(processedSchema, mainName, hashToNameMap));

  const rawCode = parts.join("\n\n");
  return await formatCode(rawCode);
};

const extractNestedSchemas = (
  schema: Record<string, unknown>,
  parentPath: string,
  extracted: Map<string, ExtractedSchemaInfo>,
  depth: number,
): Record<string, unknown> => {
  if (depth > 10 || typeof schema !== "object" || schema === null) return schema;

  if (schema.type === "object" && schema.properties) {
    const newProps: Record<string, unknown> = {};
    const props = schema.properties as Record<string, Record<string, unknown>>;

    for (const [key, propSchema] of Object.entries(props)) {
      const propPath = parentPath ? `${parentPath}.${key}` : key;
      const keyName = toLowerCamelCase(key);

      if (isNestedObject(propSchema)) {
        const processed = extractNestedSchemas(propSchema, propPath, extracted, depth + 1);

        const hash = canonicalize(processed);
        if (!extracted.has(hash)) {
          extracted.set(hash, { schema: processed, candidateNames: new Set() });
        }
        extracted.get(hash)!.candidateNames.add(keyName + "Schema");

        newProps[key] = { $zodRefHash: hash };
      } else if (isArrayOfObjects(propSchema)) {
        const itemKeyName = toLowerCamelCase(key.replace(/s$/, ""));
        const items = propSchema.items as Record<string, unknown>;

        const processed = extractNestedSchemas(items, propPath, extracted, depth + 1);

        const hash = canonicalize(processed);
        if (!extracted.has(hash)) {
          extracted.set(hash, { schema: processed, candidateNames: new Set() });
        }
        extracted.get(hash)!.candidateNames.add(itemKeyName + "Schema");

        newProps[key] = { type: "array", $zodRefItemsHash: hash };
      } else if (isArrayOfEnums(propSchema)) {
        const itemKeyName = toLowerCamelCase(key.replace(/s$/, ""));
        const items = propSchema.items as Record<string, unknown>;

        const hash = canonicalize(items);
        if (!extracted.has(hash)) {
          extracted.set(hash, { schema: items, candidateNames: new Set() });
        }
        extracted.get(hash)!.candidateNames.add(itemKeyName + "EnumSchema");

        newProps[key] = { type: "array", $zodRefItemsHash: hash };
      } else if (isEnum(propSchema)) {
        const hash = canonicalize(propSchema);
        if (!extracted.has(hash)) {
          extracted.set(hash, { schema: propSchema, candidateNames: new Set() });
        }
        extracted.get(hash)!.candidateNames.add(keyName + "EnumSchema");

        newProps[key] = { $zodRefHash: hash };
      } else {
        newProps[key] = extractNestedSchemas(propSchema, propPath, extracted, depth + 1);
      }
    }
    return { ...schema, properties: newProps };
  }

  if (schema.type === "array" && schema.items) {
    return {
      ...schema,
      items: extractNestedSchemas(
        schema.items as Record<string, unknown>,
        parentPath,
        extracted,
        depth + 1,
      ),
    };
  }

  return schema;
};

const generateNameFromCandidates = (candidates: Set<string>): string => {
  const names = Array.from(candidates);
  if (names.length === 0) return "subSchema";
  if (names.length === 1) return names[0];

  const hasSchemaSuffix = names.every((n) => n.endsWith("Schema"));
  const bases = names.map((n) => (hasSchemaSuffix ? n.replace(/Schema$/, "") : n));

  const uniqueBases = Array.from(new Set(bases.map((b) => b.toLowerCase())));

  const combined = uniqueBases
    .slice(0, 3)
    .map((b) => {
      const original = bases.find((orig) => orig.toLowerCase() === b);
      return original ? capitalize(original) : capitalize(b);
    })
    .join("And");

  const finalName = combined.charAt(0).toLowerCase() + combined.slice(1);
  return hasSchemaSuffix ? finalName + "Schema" : finalName;
};

const isNestedObject = (schema: Record<string, unknown>): boolean => {
  return (
    schema.type === "object" &&
    !!schema.properties &&
    Object.keys(schema.properties as Record<string, unknown>).length > 1
  );
};

const isArrayOfObjects = (schema: Record<string, unknown>): boolean => {
  if (schema.type !== "array" || !schema.items) return false;
  const items = schema.items as Record<string, unknown>;
  return (
    items.type === "object" &&
    !!items.properties &&
    Object.keys(items.properties as Record<string, unknown>).length > 1
  );
};

const isArrayOfEnums = (schema: Record<string, unknown>): boolean => {
  if (schema.type !== "array" || !schema.items) return false;
  const items = schema.items as Record<string, unknown>;
  return !!items.enum && Array.isArray(items.enum);
};

const isEnum = (schema: Record<string, unknown>): boolean => {
  return !!schema.enum && Array.isArray(schema.enum);
};

const convertToZodCode = (
  schema: Record<string, unknown>,
  name: string,
  hashToNameMap: Map<string, string>,
): string => {
  const preparedSchema = prepareSchemaForConversion(schema, hashToNameMap);

  let code = jsonSchemaToZod(preparedSchema, { module: "esm" });

  const lines = code.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("import ");
  });

  let schemaCode = lines.join("\n").trim();

  if (schemaCode.startsWith("export default ")) {
    schemaCode = schemaCode.slice("export default ".length);
  }

  for (const [hash, targetName] of hashToNameMap.entries()) {
    schemaCode = schemaCode
      .replace(new RegExp(`z\\.any\\(\\)\\.describe\\("REF:${targetName}"\\)`, "g"), targetName)
      .replace(
        new RegExp(`z\\.array\\(z\\.any\\(\\)\\.describe\\("REF:${targetName}"\\)\\)`, "g"),
        `z.array(${targetName})`,
      );
  }

  schemaCode = schemaCode.replace(/\.strict\(\)/g, "");

  return `export const ${name} = ${schemaCode}`;
};

const prepareSchemaForConversion = (
  schema: Record<string, unknown>,
  hashToNameMap: Map<string, string>,
): Record<string, unknown> => {
  if (typeof schema !== "object" || schema === null) return schema;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "$zodRefHash" && typeof value === "string") {
      const targetName = hashToNameMap.get(value);
      return { description: `REF:${targetName}` };
    }
    if (key === "type" && schema.$zodRefItemsHash && typeof schema.$zodRefItemsHash === "string") {
      const targetName = hashToNameMap.get(schema.$zodRefItemsHash);
      result.type = "array";
      result.items = { description: `REF:${targetName}` };
      continue;
    }
    if (key === "$zodRefItemsHash") continue;

    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        result[key] = value.map((v) =>
          typeof v === "object" && v !== null
            ? prepareSchemaForConversion(v as Record<string, unknown>, hashToNameMap)
            : v,
        );
      } else {
        result[key] = prepareSchemaForConversion(value as Record<string, unknown>, hashToNameMap);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
};
