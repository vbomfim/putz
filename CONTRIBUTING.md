# Contributing to Putz

Thank you for your interest in contributing to Putz! This document provides guidelines and steps for contributing.

## Development Setup

1. **Prerequisites** — ensure you have Node.js (v18+), Rust (latest stable), and [Tauri prerequisites](https://tauri.app/start/prerequisites/) installed.

2. **Clone and install:**
   ```bash
   git clone https://github.com/vbomfim/putz.git
   cd putz
   npm install
   ```

3. **Start development:**
   ```bash
   npm run dev
   ```

## Development Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes following the code style of the project.

3. Write tests for new functionality:
   - Frontend tests go in `src/test/` using Vitest
   - Backend tests go in the relevant Rust module using `#[cfg(test)]`

4. Ensure all checks pass:
   ```bash
   npm run lint        # TypeScript linting
   npm run test        # All tests (frontend + backend)
   npm run format:check # Code formatting
   ```

5. Commit with descriptive messages and open a pull request.

## Code Style

### TypeScript / React
- Follow the ESLint configuration in `eslint.config.js`
- Format with Prettier (see `.prettierrc`)
- Use functional components with hooks
- Add `data-testid` attributes for testable elements

### Rust
- Follow `rustfmt` configuration in `src-tauri/rustfmt.toml`
- Run `cargo fmt` before committing
- Run `cargo clippy` to catch common issues
- Place Tauri commands in `src-tauri/src/ipc/`

## Reporting Issues

Use [GitHub Issues](https://github.com/vbomfim/putz/issues) to report bugs or request features. Please include:
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- OS and version information

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
