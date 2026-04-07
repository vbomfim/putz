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
| `npm run version:bump` | Bump version across all config files     |

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
├── scripts/                # Build & utility scripts
│   └── version-bump.mjs    # Cross-file version synchronization
├── package.json            # Node.js dependencies and scripts
├── vite.config.ts          # Vite + Vitest configuration
├── eslint.config.js        # ESLint flat config
├── tsconfig.json           # TypeScript configuration
├── CHANGELOG.md            # Release history
└── .github/workflows/      # CI/CD pipelines
    ├── ci.yml              # Continuous integration
    └── release.yml         # Release build & publish
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Distribution

Putz is distributed as platform-native installers:

| Platform | Format               | Notes                              |
|----------|----------------------|------------------------------------|
| Windows  | `.msi`               | MSI installer with Start Menu shortcut |
| macOS    | `.dmg`               | Drag-to-Applications, universal binary (arm64 + x86_64) |
| Linux    | `.AppImage`, `.deb`  | AppImage for any distro, .deb for Debian/Ubuntu |

### Creating a Release

1. Bump the version:
   ```bash
   npm run version:bump -- --minor   # or --patch, --major, or explicit 1.2.3
   ```

2. Commit and tag:
   ```bash
   git add -A && git commit -m "chore: bump version to X.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```

3. The [release workflow](.github/workflows/release.yml) triggers automatically, building for all three platforms and uploading artifacts to a GitHub Release.

### Auto-Update

Putz includes built-in auto-update support via `tauri-plugin-updater`. When a new version is published to GitHub Releases, the app checks for updates on startup and shows a notification with **Update Now** / **Later** / **Skip** options.

### Version Management

The `npm run version:bump` script keeps version numbers synchronized across:
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

### Code Signing (TODO)

Release builds are currently **unsigned**. To enable code signing:

1. **Windows**: Obtain an EV code signing certificate. Set `TAURI_SIGNING_PRIVATE_KEY` in GitHub repository secrets.
2. **macOS**: Enroll in the Apple Developer Program. Configure `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, and notarization credentials.
3. **Linux**: Code signing is not required for AppImage/DEB distribution.

### Update Signing

To enable signed updates (required for the auto-updater):

```bash
# Generate a signing keypair
npx tauri signer generate -w ~/.tauri/putz.key

# Add to GitHub repository secrets:
#   TAURI_SIGNING_PRIVATE_KEY = contents of ~/.tauri/putz.key
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD = password you set (if any)

# Add the PUBLIC key to src-tauri/tauri.conf.json → plugins.updater.pubkey
```

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
