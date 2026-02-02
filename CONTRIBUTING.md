# Contributing to Swagger to Zod

Thank you for your interest in contributing to Swagger to Zod! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/swagger-to-zod.git
   cd swagger-to-zod
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Start the development server:
   ```bash
   pnpm dev
   ```

## Development Workflow

### Running the Extension Locally

**Chrome:**

1. Run `pnpm dev` for hot reload during development
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `.output/chrome-mv3` directory

**Firefox:**

1. Run `pnpm dev:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" and select any file in `.output/firefox-mv2`

### Building for Production

```bash
pnpm build        # Chrome
pnpm build:firefox # Firefox
```

## Submitting Changes

1. Create a new branch for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes
3. Run type checking:
   ```bash
   pnpm compile
   ```
4. Commit your changes with a clear message
5. Push to your fork and submit a Pull Request

## Reporting Issues

When reporting issues, please include:

- Browser and version
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- The Swagger UI URL (if public)

## Questions?

Feel free to open an issue for any questions or discussions.
