# Putz — Cross-Platform Terminal Emulator

A modern, cross-platform terminal emulator inspired by SecureCRT, built with [Tauri 2.0](https://tauri.app/), [React](https://react.dev/), and [TypeScript](https://www.typescriptlang.org/).

## Features (Planned)

- 🖥️ Cross-platform: Windows, macOS, Linux
- 🔒 SSH, Telnet, Serial protocol support
- 📑 Tabbed sessions with split panes
- 🎨 Customizable themes and key bindings
- 📁 Session management and organization

## Tech Stack

| Layer    | Technology          |
|----------|---------------------|
| Frontend | React + TypeScript  |
| Backend  | Rust (Tauri 2.0)    |
| Terminal | xterm.js (planned)  |
| Build    | Vite                |
| Test     | Vitest + Cargo test |
| Lint     | ESLint + Prettier   |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Tauri 2.0 prerequisites](https://tauri.app/start/prerequisites/) for your platform

## Getting Started

```bash
# Clone the repository
git clone https://github.com/vbomfim/putz.git
cd putz

# Install dependencies
npm install

# Start development mode (launches the Tauri window with hot reload)
npm run dev
```

## Available Scripts

| Command              | Description                                |
|----------------------|--------------------------------------------|
| `npm run dev`        | Start Tauri dev mode with hot reload       |
| `npm run build`      | Production build (creates distributable)   |
| `npm run test`       | Run all tests (frontend + backend)         |
| `npm run test:frontend` | Run frontend tests only (Vitest)        |
| `npm run test:backend`  | Run backend tests only (Cargo test)     |
| `npm run test:watch` | Run frontend tests in watch mode           |
| `npm run lint`       | Lint TypeScript with ESLint                |
| `npm run lint:fix`   | Auto-fix lint issues                       |
| `npm run format`     | Format code with Prettier                  |
| `npm run format:check` | Check code formatting                    |

## Project Structure

```
putz/
├── src/                    # React frontend
│   ├── App.tsx             # Main application component
│   ├── main.tsx            # React entry point
│   ├── components/         # Reusable React components
│   ├── hooks/              # Custom React hooks
│   ├── stores/             # State management
│   ├── styles/             # CSS styling
│   ├── test/               # Test setup and test files
│   └── types/              # TypeScript type definitions
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Tauri application entry point
│   │   ├── lib.rs          # Library root with Tauri builder
│   │   └── commands/       # Tauri command handlers
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── package.json            # Node.js dependencies and scripts
├── vite.config.ts          # Vite + Vitest configuration
├── eslint.config.js        # ESLint flat config
├── tsconfig.json           # TypeScript configuration
└── .github/workflows/      # CI/CD pipelines
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
