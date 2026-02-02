# Swagger to Zod

A browser extension that automatically generates [Zod](https://github.com/colinhacks/zod) schemas from JSON examples in Swagger UI pages.

## Features

- Automatically detects JSON response examples in Swagger UI
- Generates type-safe Zod v4 schemas with one click
- Displays schemas side-by-side with the original JSON
- Syntax highlighting for both JSON and TypeScript
- Works with OpenAPI 2.x (Swagger) and OpenAPI 3.x specifications
- Supports Chrome and Firefox

## Installation

### Chrome

#### Chrome Web Store

[Chrome Web Store](https://chromewebstore.google.com/detail/swagger-to-zod/jmoopnnfjlobenhellaooeoohhlheein)

#### Manual Installation

1. Download or clone this repository
2. Run `pnpm install` to install dependencies
3. Run `pnpm build` to build the extension
4. Open Chrome and navigate to `chrome://extensions`
5. Enable "Developer mode" in the top right
6. Click "Load unpacked" and select the `.output/chrome-mv3` directory

### Firefox

#### Firefox Add-ons

Coming soon...

#### Manual Installation

1. Download or clone this repository
2. Run `pnpm install` to install dependencies
3. Run `pnpm build:firefox` to build the extension
4. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
5. Click "Load Temporary Add-on" and select any file in the `.output/firefox-mv2` directory

## Usage

1. Navigate to any Swagger UI page (e.g., https://petstore.swagger.io/)
2. Expand an API endpoint to view its response examples
3. The extension automatically displays Zod schemas next to JSON examples
4. Click the copy button to copy the Zod schema to your clipboard

## Development

```bash
# Install dependencies
pnpm install

# Start development server with hot reload
pnpm dev

# Build for production
pnpm build

# Type check
pnpm compile

# Create distribution zip
pnpm zip
```

## How It Works

1. The extension injects a content script into Swagger UI pages
2. It extracts the OpenAPI specification from the page (either from memory or by fetching the spec URL)
3. When JSON examples are detected, it:
   - Parses the JSON to infer the schema structure
   - Attempts to match the response with the OpenAPI spec for accurate type information
   - Generates a Zod schema using `json-schema-to-zod`
   - Displays the schema with syntax highlighting

## License

[MIT](LICENSE)
