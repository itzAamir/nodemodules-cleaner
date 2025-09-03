# Build and Release Guide

This document explains how to build and release the NodeModules Cleaner application across different platforms using GitHub Actions.

## 🚀 Automated Builds

### Release Builds (Production)
- **Trigger**: Push a tag starting with `v` (e.g., `v1.0.0`) or manual workflow dispatch
- **Platforms**: Windows (x64), macOS (Intel + Apple Silicon), Linux (x64)
- **Outputs**: 
  - Windows: `.exe` installer and `.msi` package
  - macOS: `.dmg` files for both Intel and Apple Silicon
  - Linux: `.deb` package
- **Artifacts**: Automatically uploaded to GitHub Releases

### Development Builds
- **Trigger**: Push to `main` branch or pull requests
- **Platforms**: Windows (x64), macOS (Intel), Linux (x64)
- **Outputs**: Debug executables for testing
- **Artifacts**: Available for 7 days

## 🛠️ Local Development

### Prerequisites
- Node.js 20+
- Rust (latest stable)
- Yarn package manager
- Platform-specific dependencies:
  - **Windows**: Visual Studio Build Tools
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `libssl-dev`

### Available Scripts

```bash
# Development
yarn dev                    # Start Vite dev server
yarn tauri:dev             # Start Tauri development mode

# Building
yarn build                 # Build frontend only
yarn tauri:build           # Build for current platform
yarn tauri:build:debug     # Build debug version
yarn tauri:build:windows   # Build for Windows
yarn tauri:build:macos     # Build for macOS (Intel)
yarn tauri:build:macos-arm # Build for macOS (Apple Silicon)
yarn tauri:build:linux     # Build for Linux
```

## 📦 Build Optimization

### Size Optimization
The build is optimized for minimal size:
- **Rust**: `opt-level = "z"` (optimize for size)
- **LTO**: Link Time Optimization enabled
- **Strip**: Debug symbols removed
- **Single codegen unit**: Better optimization

### Caching Strategy
- **Node.js**: Yarn cache for faster dependency installation
- **Rust**: Cargo registry and target directory caching
- **Build artifacts**: Platform-specific caching keys

## 🔐 Code Signing (Optional)

For production releases, you can set up code signing:

1. Generate a Tauri keypair:
   ```bash
   yarn tauri signer generate -w ~/.tauri/myapp.key
   ```

2. Add secrets to GitHub repository:
   - `TAURI_PRIVATE_KEY`: Content of the private key file
   - `TAURI_KEY_PASSWORD`: Password for the private key

## 🚀 Creating a Release

1. **Update version** in `package.json` and `src-tauri/Cargo.toml`
2. **Create and push a tag**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. **GitHub Actions will automatically**:
   - Build for all platforms
   - Create a GitHub release
   - Upload all artifacts
   - Generate release notes

## 📁 Build Outputs

### Windows
- `nodemodules-cleaner_0.1.0_x64_en-US.exe` - NSIS installer
- `nodemodules-cleaner_0.1.0_x64_en-US.msi` - MSI package

### macOS
- `NodeModules Cleaner_0.1.0_x64.dmg` - Intel Mac
- `NodeModules Cleaner_0.1.0_aarch64.dmg` - Apple Silicon Mac

### Linux
- `nodemodules-cleaner_0.1.0_amd64.deb` - Debian package

## 🔧 Troubleshooting

### Common Issues

1. **Build fails on macOS**: Ensure Xcode Command Line Tools are installed
2. **Linux build fails**: Install required system dependencies
3. **Windows build fails**: Install Visual Studio Build Tools
4. **Cache issues**: Clear GitHub Actions cache or use different cache keys

### Performance Tips

1. **Use matrix builds**: Parallel builds for faster CI/CD
2. **Enable caching**: Reduces build times significantly
3. **Optimize dependencies**: Keep dependencies minimal
4. **Use release profiles**: Optimized Rust builds for production

## 📊 Build Statistics

Typical build times with caching:
- **First build**: 8-12 minutes per platform
- **Cached build**: 3-5 minutes per platform
- **Total release time**: 15-20 minutes (parallel builds)

## 🔄 Workflow Triggers

| Event | Workflow | Purpose |
|-------|----------|---------|
| Tag push (`v*`) | `build.yml` | Production release |
| Manual dispatch | `build.yml` | Manual release |
| Push to `main` | `dev-build.yml` | Development testing |
| Pull request | `dev-build.yml` | PR validation |

## 📝 Notes

- All builds are reproducible and deterministic
- Debug builds are available for development testing
- Release builds are optimized for size and performance
- Cross-compilation is handled automatically by GitHub Actions
