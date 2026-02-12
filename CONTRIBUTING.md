# Contributing to Cowork-Z

Thank you for your interest in contributing to Cowork-Z! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

Before submitting a bug report:

1. Check the [existing issues](https://github.com/kevinlin/cowork-z/issues) to avoid duplicates.
2. Use the bug report template if one is available.

When filing a bug report, include:

- A clear, descriptive title.
- Steps to reproduce the issue.
- Expected vs. actual behavior.
- Your environment (macOS version, app version).
- Screenshots or logs if applicable.

### Suggesting Features

Feature requests are welcome! Please:

1. Check existing issues and discussions first.
2. Open a new issue describing the feature, the motivation behind it, and any proposed implementation ideas.

### Pull Requests

1. **Fork** the repository and create your branch from `main`.
2. **Follow the setup instructions** below to get the project running locally.
3. **Make your changes** — keep commits focused and atomic.
4. **Add or update tests** for any new or changed functionality.
5. **Run the full validation suite** before submitting (see below).
6. **Open a pull request** with a clear description of the change and link any related issues.

## Development Setup

### Prerequisites

- **Node.js** (v20+)
- **pnpm** (v9+)
- **Rust** (stable toolchain)
- **Tauri CLI** (`cargo install tauri-cli`)
- **OpenCode** (`npm install -g opencode-ai`)
- **macOS** (primary development platform)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/kevinlin/cowork-z.git
cd cowork-z

# Install frontend dependencies
pnpm install

# Install sidecar dependencies
cd src-tauri/sidecar-opencode
pnpm install
cd ../..

# Start the full-stack development server
pnpm tauri dev
```

### Project Structure

```
├── src/                  # React/TypeScript frontend
├── src-tauri/
│   ├── src/              # Rust backend (Tauri commands)
│   └── sidecar-opencode/ # Node.js sidecar (OpenCode integration)
├── docs/                 # Design specs and plans
└── public/               # Static assets
```

## Development Workflow

### Running Tests

```bash
# Frontend tests (Vitest)
pnpm test --run

# Frontend tests with coverage
pnpm test:coverage

# Sidecar tests (Jest)
cd src-tauri/sidecar-opencode && pnpm test

# Rust tests
cd src-tauri && cargo test
```

### Type Checking & Linting

```bash
# TypeScript type check
pnpm typecheck

# Rust check
cd src-tauri && cargo check

# Lint & format (Ultracite / Biome)
pnpm dlx ultracite fix src/ src-tauri/sidecar-opencode/
pnpm dlx ultracite check src/ src-tauri/sidecar-opencode/
```

### Before Submitting a PR

Please ensure all of the following pass:

```bash
pnpm typecheck
pnpm test --run
cd src-tauri && cargo check
cd src-tauri && cargo test
cd src-tauri/sidecar-opencode && pnpm test
```

## Coding Guidelines

### General

- Write clear, self-documenting code with meaningful variable and function names.
- Keep functions small and focused on a single responsibility.
- Add comments for non-obvious logic; avoid redundant comments.

### TypeScript / React

- Use TypeScript strict mode — no `any` types unless absolutely necessary.
- Use path aliases (`@/` for `src/`, `@shared/` for `src/shared/`).
- Follow existing component patterns: Radix UI primitives with shadcn/ui styling.
- State management goes through the Zustand store in `src/stores/taskStore.ts`.
- All Tauri IPC calls go through `src/lib/tauri-api.ts`.

### Rust

- Follow standard Rust conventions (`rustfmt`, `clippy`).
- Keep Tauri command handlers in `src-tauri/src/lib.rs`.
- Sidecar process management lives in `src-tauri/src/sidecar.rs`.

### Sidecar (Node.js)

- CommonJS only — the sidecar is compiled with `pkg` which has limited ESM support.
- Types are defined in `src-tauri/sidecar-opencode/src/types.ts`.

### Tests

- Collocate tests with source files (`*.test.ts` / `*.test.tsx`).
- Use `@testing-library/react` for component tests.
- Aim for meaningful test coverage — focus on behavior, not implementation details.

## Commit Messages

Write clear, concise commit messages:

- Use the imperative mood ("Add feature" not "Added feature").
- Keep the first line under 72 characters.
- Reference issue numbers where applicable (e.g., `Fix #42`).

## License

By contributing to Cowork-Z, you agree that your contributions will be licensed under the [MIT License](LICENSE).
