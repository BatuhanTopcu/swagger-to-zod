import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import { copyToClipboard, showFeedback } from "./clipboard";
import {
  extractBalancedJson,
  extractSchemaFromElement,
  getOpenAPISpec,
  inferSchemaFromValue,
  resolveRefs,
} from "./schema-extractor";
import { jsonSchemaToZodWithExtraction } from "./zod-formatter";

const ZOD_SCHEMA_WRAPPER_CLASS = "swagger-zod-schema-wrapper";
const PROCESSED_ATTR = "data-swagger-zod-processed";
const CONTENT_HASH_ATTR = "data-swagger-zod-content-hash";
const EDITABLE_INPUT_SELECTOR =
  "textarea, input, [contenteditable=''], [contenteditable='true'], .CodeMirror, .cm-editor, .monaco-editor";

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>`;

const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"></polyline>
</svg>`;

const triggerHighlight = () => {
  window.dispatchEvent(new CustomEvent("swagger-zod-trigger-highlight"));
  requestAnimationFrame(() => {
    const zodCodeBlocks = document.querySelectorAll(".swagger-zod-zod-side .swagger-zod-code code");
    zodCodeBlocks.forEach((codeBlock) => {
      if (codeBlock.querySelector("span")) return;
      try {
        Prism.highlightElement(codeBlock as Element);
      } catch {}
    });
  });
};

const simpleHash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
};

const resetProcessedElement = (element: Element): void => {
  const parent = element.parentElement;
  if (!parent) return;

  const wrapper = parent.querySelector(`.${ZOD_SCHEMA_WRAPPER_CLASS}`);
  if (wrapper) {
    wrapper.remove();
  }

  if (element.tagName === "PRE") {
    (element as HTMLElement).style.display = "";
  }

  const hiddenPre = parent.querySelector(`pre[${PROCESSED_ATTR}]`);
  if (hiddenPre) {
    (hiddenPre as HTMLElement).style.display = "";
  }

  element.removeAttribute(PROCESSED_ATTR);
  element.removeAttribute(CONTENT_HASH_ATTR);
};

const cleanupOrphanedWrappers = (): void => {
  const wrappers = document.querySelectorAll(`.${ZOD_SCHEMA_WRAPPER_CLASS}`);

  wrappers.forEach((wrapper) => {
    const parent = wrapper.parentElement;
    if (!parent) {
      wrapper.remove();
      return;
    }

    const hiddenPre = parent.querySelector(
      `pre[${PROCESSED_ATTR}][style*="display: none"], pre[${PROCESSED_ATTR}][style*="display:none"]`,
    );

    if (!hiddenPre) {
      const newPre = parent.querySelector(`pre:not([${PROCESSED_ATTR}]):not(.swagger-zod-code)`);
      if (newPre) {
        wrapper.remove();
      }
    }
  });
};

export const injectCopyButtons = async (): Promise<number> => {
  let count = 0;

  cleanupOrphanedWrappers();

  const candidates = Array.from(
    document.querySelectorAll(
      "pre, .microlight, .highlight-code, .model-example, .example-value, code",
    ),
  );

  for (const element of candidates) {
    if (element.closest(`.${ZOD_SCHEMA_WRAPPER_CLASS}`)) continue;
    if (element.tagName === "CODE" && element.closest("pre")) continue;
    if ((element as HTMLElement).matches?.(EDITABLE_INPUT_SELECTOR)) continue;
    if (element.closest(EDITABLE_INPUT_SELECTOR)) continue;

    const text = element.textContent?.trim() || "";
    if (!text) continue;

    const contentHash = simpleHash(text);
    const previousHash = element.getAttribute(CONTENT_HASH_ATTR);

    if (element.hasAttribute(PROCESSED_ATTR)) {
      if (previousHash !== contentHash) {
        resetProcessedElement(element);
      } else {
        continue;
      }
    }

    const jsonString = extractBalancedJson(text);
    if (!jsonString) continue;

    let jsonData: unknown = null;
    try {
      jsonData = JSON.parse(jsonString);
    } catch {
      continue;
    }

    if (!jsonData || typeof jsonData !== "object") continue;

    const layoutTarget = findLayoutTarget(element);
    if (shouldSkipInjectionForTarget(element, layoutTarget)) continue;

    if (
      layoutTarget.hasAttribute(PROCESSED_ATTR) ||
      layoutTarget.querySelector(`.${ZOD_SCHEMA_WRAPPER_CLASS}`)
    ) {
      continue;
    }

    let schema = inferSchemaFromValue(jsonData);

    const spec = getOpenAPISpec();
    if (spec) {
      const schemaSource = element.closest(".response") || layoutTarget || element;
      const specSchema = extractSchemaFromElement(schemaSource);
      if (specSchema) {
        schema = resolveRefs(specSchema, spec);
      }
      schema = resolveRefs(schema, spec);
    }

    const zodCode = await jsonSchemaToZodWithExtraction(schema, "responseSchema");
    if (!zodCode) continue;

    const applied = createSideBySideLayout(layoutTarget, zodCode);
    if (applied) {
      element.setAttribute(PROCESSED_ATTR, "true");
      element.setAttribute(CONTENT_HASH_ATTR, contentHash);
      layoutTarget.setAttribute(PROCESSED_ATTR, "true");
      layoutTarget.setAttribute(CONTENT_HASH_ATTR, contentHash);

      const pre = layoutTarget.querySelector("pre");
      if (pre) {
        pre.setAttribute(PROCESSED_ATTR, "true");
        pre.setAttribute(CONTENT_HASH_ATTR, contentHash);
      }

      count++;
    }
  }

  return count;
};

const findLayoutTarget = (element: Element): Element => {
  const wrapper = element.closest(".model-example, .example-value, .highlight-code, .microlight");
  if (wrapper) return wrapper;

  if (
    element.tagName === "PRE" &&
    element.parentElement &&
    !element.parentElement.classList.contains("opblock-body")
  ) {
    return element.parentElement;
  }

  return element;
};

const isResponseContext = (element: Element): boolean => {
  return !!element.closest(".response, .responses-wrapper");
};

const hasEditableInputs = (element: Element): boolean => {
  return !!element.querySelector(EDITABLE_INPUT_SELECTOR);
};

const isRequestBodyContext = (element: Element): boolean => {
  return !!element.closest(
    ".opblock-body, .body-param, .opblock-section-request-body, .request-body",
  );
};

const shouldSkipInjectionForTarget = (source: Element, target: Element): boolean => {
  if (isResponseContext(source) || isResponseContext(target)) {
    return false;
  }

  if (!isRequestBodyContext(source) && !isRequestBodyContext(target)) {
    return false;
  }

  if (hasEditableInputs(target)) return true;
  if (hasEditableInputs(source)) return true;

  const requestContainer =
    target.closest(".body-param, .opblock-section-request-body, .request-body, .opblock-body") ||
    source.closest(".body-param, .opblock-section-request-body, .request-body, .opblock-body");

  return !!requestContainer?.querySelector(EDITABLE_INPUT_SELECTOR);
};

export const removeCopyButtons = (): void => {
  document.querySelectorAll(`.${ZOD_SCHEMA_WRAPPER_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((el) => {
    el.removeAttribute(PROCESSED_ATTR);
    el.removeAttribute(CONTENT_HASH_ATTR);
    if (el.tagName === "PRE") {
      (el as HTMLElement).style.display = "";
    }
  });
};

const createSideBySideLayout = (target: Element, zodCode: string): boolean => {
  if (target.querySelector(`.${ZOD_SCHEMA_WRAPPER_CLASS}`)) return false;
  if (shouldSkipInjectionForTarget(target, target)) return false;

  let preBlock: HTMLPreElement | null = target.querySelector("pre");
  if (!preBlock && target.tagName === "PRE") preBlock = target as HTMLPreElement;

  if (!preBlock) {
    const leftSide = document.createElement("div");
    leftSide.className = "swagger-zod-example-wrapper";

    while (target.firstChild) {
      leftSide.appendChild(target.firstChild);
    }

    const grid = buildGrid(leftSide, zodCode, null, null);
    target.appendChild(grid);
    return true;
  }

  const parentOfPre = preBlock.parentElement;
  if (!parentOfPre) return false;

  const leftSide = document.createElement("div");
  leftSide.className = "swagger-zod-example-wrapper";

  const sourcePreClassName = preBlock.className;
  const sourceCode = preBlock.querySelector("code");
  const sourceCodeClassName = sourceCode?.className || null;

  const jsonPre = preBlock.cloneNode(true) as HTMLPreElement;
  jsonPre.className = mergeCodeBlockClassName(sourcePreClassName);
  jsonPre.removeAttribute(PROCESSED_ATTR);
  jsonPre.removeAttribute(CONTENT_HASH_ATTR);
  jsonPre.style.display = "";
  leftSide.appendChild(jsonPre);

  const grid = buildGrid(leftSide, zodCode, sourcePreClassName, sourceCodeClassName);

  (preBlock as HTMLElement).style.display = "none";
  preBlock.setAttribute(PROCESSED_ATTR, "true");

  parentOfPre.insertBefore(grid, preBlock);

  triggerHighlight();

  return true;
};

const mergeCodeBlockClassName = (baseClassName: string | null | undefined): string => {
  const base = (baseClassName || "").trim();
  const baseWithMicrolight = base.includes("microlight") ? base : `${base} microlight`.trim();
  return baseWithMicrolight
    ? `${baseWithMicrolight} swagger-zod-code`
    : "microlight swagger-zod-code";
};

const normalizeCodeClassForZod = (baseCodeClassName: string | null): string => {
  const base = (baseCodeClassName || "").trim();
  const withoutJsonLanguage = base
    .replace(/\blanguage-json\b/g, "")
    .replace(/\blang-json\b/g, "")
    .trim();
  const withJsLanguage = /\blanguage-(typescript|javascript)\b/.test(withoutJsonLanguage)
    ? withoutJsonLanguage
    : `${withoutJsonLanguage} language-javascript`.trim();
  return withJsLanguage;
};

const buildGrid = (
  leftContent: HTMLElement,
  zodCode: string,
  sourcePreClassName: string | null,
  sourceCodeClassName: string | null,
): HTMLElement => {
  const gridContainer = document.createElement("div");
  gridContainer.className = ZOD_SCHEMA_WRAPPER_CLASS;
  gridContainer.setAttribute("data-swagger-zod-injected", "true");

  if (!leftContent.classList.contains("swagger-zod-example-wrapper")) {
    leftContent.classList.add("swagger-zod-example-wrapper");
  }
  gridContainer.appendChild(leftContent);

  const zodCodeBlock = document.createElement("pre");
  zodCodeBlock.className = mergeCodeBlockClassName(sourcePreClassName);
  zodCodeBlock.style.whiteSpace = "pre";
  const zodCodeElement = document.createElement("code");
  zodCodeElement.className = normalizeCodeClassForZod(sourceCodeClassName);
  zodCodeElement.textContent = zodCode;
  zodCodeBlock.appendChild(zodCodeElement);

  const zodWrapper = document.createElement("div");
  zodWrapper.className = "swagger-zod-zod-side";
  zodWrapper.appendChild(zodCodeBlock);

  const copyButton = document.createElement("button");
  copyButton.className = "swagger-zod-copy-btn swagger-zod-copy-btn-absolute";
  copyButton.innerHTML = COPY_ICON;
  copyButton.title = "Copy Zod schema";
  copyButton.type = "button";

  copyButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const success = await copyToClipboard(zodCode);
    if (success) {
      copyButton.innerHTML = CHECK_ICON;
      copyButton.classList.add("success");
      showFeedback(copyButton, true, "Copied!");
      setTimeout(() => {
        copyButton.innerHTML = COPY_ICON;
        copyButton.classList.remove("success");
      }, 2000);
    } else {
      showFeedback(copyButton, false, "Copy failed");
    }
  });

  zodWrapper.appendChild(copyButton);
  gridContainer.appendChild(zodWrapper);

  return gridContainer;
};
