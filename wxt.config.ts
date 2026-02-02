import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: "Swagger to Zod",
    description:
      "Adds a one-click button to Swagger UI to instantly copy API responses as Zod schemas. Supports OpenAPI 2 & 3.",
    permissions: ["clipboardWrite"],
    web_accessible_resources: [
      {
        resources: ["injected.js"],
        matches: ["<all_urls>"],
      },
    ],
  },
});
