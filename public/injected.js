(() => {
  let cachedSpec = null;

  const getSpecFromMemory = () => {
    if (cachedSpec) return cachedSpec;

    try {
      const ui = window.ui;
      if (ui?.specSelectors?.specJson) {
        const rawSpec = ui.specSelectors.specJson();
        if (rawSpec?.toJS) return (cachedSpec = rawSpec.toJS());
        if (rawSpec && typeof rawSpec === "object")
          return (cachedSpec = JSON.parse(JSON.stringify(rawSpec)));
      }
      if (window.swaggerSpec) return (cachedSpec = window.swaggerSpec);
    } catch (e) {}

    return null;
  };

  const fetchSpec = () => {
    return new Promise((resolve) => {
      const origin = window.location.origin;
      const pathname = window.location.pathname.replace(/\/swagger-ui.*/, "").replace(/\/$/, "");

      const paths = [
        "/json",
        "/v3/api-docs",
        "/v2/api-docs",
        "/swagger.json",
        "/openapi.json",
        "/api-docs",
      ];
      const urls = paths.map((p) => origin + pathname + p);

      if (pathname) {
        paths.forEach((p) => urls.push(origin + p));
      }

      const tryNext = (i) => {
        if (i >= urls.length) return resolve(null);

        fetch(urls[i], { credentials: "include" })
          .then((r) => {
            if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw 0;
            return r.json();
          })
          .then((data) => {
            if (data?.paths || data?.openapi || data?.swagger) {
              cachedSpec = data;
              resolve(data);
            } else tryNext(i + 1);
          })
          .catch(() => tryNext(i + 1));
      };

      tryNext(0);
    });
  };

  window.addEventListener("swagger-zod-get-spec", () => {
    const spec = getSpecFromMemory();
    if (spec) {
      window.dispatchEvent(
        new CustomEvent("swagger-zod-spec-response", { detail: JSON.stringify(spec) }),
      );
      return;
    }

    fetchSpec().then((spec) => {
      window.dispatchEvent(
        new CustomEvent("swagger-zod-spec-response", {
          detail: spec ? JSON.stringify(spec) : null,
        }),
      );
    });
  });

  window.addEventListener("swagger-zod-trigger-highlight", () => {
    if (window.Microlight) {
      window.Microlight.reset();
    }
    if (window.Prism) {
      window.Prism.highlightAll();
    }
    if (window.hljs) {
      const codeBlocks = document.querySelectorAll(".swagger-zod-code code, pre.swagger-zod-code");
      codeBlocks.forEach((block) => {
        try {
          window.hljs.highlightElement(block);
        } catch {}

        const tokenized = block.querySelector?.("span") || block.classList?.contains("hljs");
        if (!tokenized && block.textContent) {
          try {
            const highlighted = window.hljs.highlight(block.textContent, {
              language: "javascript",
            });
            block.innerHTML = highlighted.value;
            block.classList?.add("hljs");
          } catch {}
        }
      });
    }
  });
})();
