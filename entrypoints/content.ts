import "prismjs/themes/prism-tomorrow.css";
import "../assets/content.css";
import { injectCopyButtons, removeCopyButtons } from "../utils/button-injector";
import { setSpecFromMainWorld } from "../utils/schema-extractor";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  async main() {
    if (!isSwaggerUIPage()) return;

    await injectMainWorldScript();
    requestSpecFromMainWorld();

    setTimeout(async () => {
      const initialCount = await injectCopyButtons();
      if (initialCount > 0) {
        setTimeout(() => injectCopyButtons(), 1000);
      }
      setTimeout(() => injectCopyButtons(), 2000);
    }, 500);

    let timeout: ReturnType<typeof setTimeout>;
    let isInjecting = false;

    const observer = new MutationObserver(
      createMutationHandler(
        () => isInjecting,
        (val) => {
          isInjecting = val;
        },
        () => timeout,
        (val) => {
          timeout = val;
        },
      ),
    );

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-code", "style", "hidden", "aria-hidden"],
    });

    return () => {
      observer.disconnect();
      removeCopyButtons();
    };
  },
});

const isOurInjectedElement = (el: Element): boolean => {
  return (
    el.classList?.contains("swagger-zod-schema-wrapper") ||
    el.hasAttribute?.("data-swagger-zod-injected") ||
    el.closest?.(".swagger-zod-schema-wrapper") !== null ||
    (el.querySelector && el.querySelector(".swagger-zod-schema-wrapper") !== null)
  );
};

const isSwaggerElement = (el: Element): boolean => {
  return (
    el.classList?.contains("opblock") ||
    el.classList?.contains("response") ||
    el.classList?.contains("model-example") ||
    el.classList?.contains("example-value") ||
    el.querySelector?.(".opblock, .response, .model-example, .example-value") !== null ||
    el.closest?.(".opblock, .response") !== null
  );
};

const isRelevantSwaggerChange = (mutations: MutationRecord[]): boolean => {
  for (const mutation of mutations) {
    for (const node of Array.from(mutation.addedNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (!isOurInjectedElement(el) && isSwaggerElement(el)) {
          return true;
        }
      }
    }

    if (mutation.type === "attributes") {
      const target = mutation.target as Element;
      if (
        target.classList?.contains("opblock") ||
        target.classList?.contains("response") ||
        target.closest?.(".opblock, .response") !== null
      ) {
        return true;
      }
    }
  }

  for (const mutation of mutations) {
    const target = mutation.target as Element;
    if (
      target &&
      (target.classList?.contains("opblock") ||
        target.classList?.contains("response") ||
        target.closest?.(".opblock, .response") !== null)
    ) {
      return true;
    }
  }

  return false;
};

const areOnlyOurMutations = (mutations: MutationRecord[]): boolean => {
  for (const mutation of mutations) {
    for (const node of Array.from(mutation.addedNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (!isOurInjectedElement(el)) {
          return false;
        }
      }
    }

    if (mutation.type === "attributes") {
      const target = mutation.target as Element;
      if (
        target.classList?.contains("opblock") ||
        target.classList?.contains("response") ||
        target.closest?.(".opblock, .response") !== null
      ) {
        return false;
      }
    }
  }
  return true;
};

const createMutationHandler = (
  getIsInjecting: () => boolean,
  setIsInjecting: (val: boolean) => void,
  getTimeout: () => ReturnType<typeof setTimeout>,
  setTimeout_: (val: ReturnType<typeof setTimeout>) => void,
): MutationCallback => {
  return (mutations) => {
    if (getIsInjecting()) return;
    if (areOnlyOurMutations(mutations)) return;
    if (!isRelevantSwaggerChange(mutations)) return;

    clearTimeout(getTimeout());
    setTimeout_(
      setTimeout(async () => {
        setIsInjecting(true);
        try {
          const injectedCount = await injectCopyButtons();
          if (injectedCount > 0) {
            setTimeout(() => {
              try {
                injectCopyButtons();
              } catch {}
            }, 500);
          }
        } finally {
          setTimeout(() => {
            setIsInjecting(false);
          }, 50);
        }
      }, 150),
    );
  };
};

const isSwaggerUIPage = (): boolean => {
  return !!(
    document.querySelector(".swagger-ui") ||
    document.title.toLowerCase().includes("swagger") ||
    document.querySelector('.opblock, .model-box, #swagger-ui, [class*="swagger"]')
  );
};

const injectMainWorldScript = async () => {
  const scriptUrl = browser.runtime.getURL("injected.js");
  const script = document.createElement("script");
  script.src = scriptUrl;

  await new Promise<void>((resolve) => {
    script.onload = () => resolve();
    script.onerror = () => resolve();
    (document.head || document.documentElement).appendChild(script);
  });

  await new Promise((r) => setTimeout(r, 100));
};

const requestSpecFromMainWorld = () => {
  window.addEventListener(
    "swagger-zod-spec-response",
    ((event: CustomEvent) => {
      if (event.detail) {
        try {
          setSpecFromMainWorld(JSON.parse(event.detail));
        } catch {}
      }
    }) as EventListener,
    { once: true },
  );

  window.dispatchEvent(new CustomEvent("swagger-zod-get-spec"));
};
