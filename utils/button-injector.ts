import Prism from "prismjs";
(window as any).Prism = Prism;

import "prismjs/components/prism-json";
import "prismjs/components/prism-typescript";

Prism.manual = true;

import {
  extractBalancedJson,
  extractSchemaFromElement,
  getOpenAPISpec,
  inferSchemaFromValue,
  resolveRefs,
} from "./schema-extractor";
import { jsonSchemaToZodWithExtraction } from "./zod-formatter";
import { copyToClipboard, showFeedback } from "./clipboard";

const ZOD_SCHEMA_WRAPPER_CLASS = "swagger-zod-schema-wrapper";
const PROCESSED_ATTR = "data-swagger-zod-processed";
const CONTENT_HASH_ATTR = "data-swagger-zod-content-hash";

const CODE_BLOCK_STYLES = {
  display: "block",
  overflowX: "auto",
  padding: "0.5em",
  background: "rgb(51, 51, 51)",
  color: "white",
  margin: "0",
  borderRadius: "8px",
};

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>`;

const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"></polyline>
</svg>`;

const triggerHighlight = (container: HTMLElement) => {
  const codeBlocks = container.querySelectorAll(".swagger-zod-code code");
  codeBlocks.forEach((block) => {
    Prism.highlightElement(block);
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

    if (
      layoutTarget.hasAttribute(PROCESSED_ATTR) ||
      layoutTarget.querySelector(`.${ZOD_SCHEMA_WRAPPER_CLASS}`)
    ) {
      continue;
    }

    let schema = inferSchemaFromValue(jsonData);

    const spec = getOpenAPISpec();
    if (spec) {
      const responseRow = element.closest(".response");
      if (responseRow) {
        const specSchema = extractSchemaFromElement(responseRow);
        if (specSchema) {
          schema = resolveRefs(specSchema, spec);
        }
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

  let preBlock: HTMLPreElement | null = target.querySelector("pre");
  if (!preBlock && target.tagName === "PRE") preBlock = target as HTMLPreElement;

  if (!preBlock) {
    const leftSide = document.createElement("div");
    leftSide.className = "swagger-zod-example-wrapper";

    while (target.firstChild) {
      leftSide.appendChild(target.firstChild);
    }

    const grid = buildGrid(leftSide, zodCode);
    target.appendChild(grid);
    return true;
  }

  const parentOfPre = preBlock.parentElement;
  if (!parentOfPre) return false;

  const leftSide = document.createElement("div");
  leftSide.className = "swagger-zod-example-wrapper";

  const jsonPre = document.createElement("pre");
  jsonPre.className = "example microlight swagger-zod-code";
  Object.assign(jsonPre.style, CODE_BLOCK_STYLES);

  const jsonCode = document.createElement("code");
  jsonCode.className = "language-json";
  jsonCode.style.whiteSpace = "pre";
  jsonCode.textContent = preBlock.textContent || "";

  jsonPre.appendChild(jsonCode);
  leftSide.appendChild(jsonPre);

  const grid = buildGrid(leftSide, zodCode);

  (preBlock as HTMLElement).style.display = "none";
  preBlock.setAttribute(PROCESSED_ATTR, "true");

  parentOfPre.insertBefore(grid, preBlock);

  triggerHighlight(grid);

  return true;
};

const buildGrid = (leftContent: HTMLElement, zodCode: string): HTMLElement => {
  const gridContainer = document.createElement("div");
  gridContainer.className = ZOD_SCHEMA_WRAPPER_CLASS;
  gridContainer.setAttribute("data-swagger-zod-injected", "true");

  if (!leftContent.classList.contains("swagger-zod-example-wrapper")) {
    leftContent.classList.add("swagger-zod-example-wrapper");
  }
  gridContainer.appendChild(leftContent);

  const zodCodeBlock = document.createElement("pre");
  zodCodeBlock.className = "example microlight swagger-zod-code";
  Object.assign(zodCodeBlock.style, CODE_BLOCK_STYLES);

  const zodCodeElement = document.createElement("code");
  zodCodeElement.className = "language-typescript";
  zodCodeElement.style.whiteSpace = "pre";
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
