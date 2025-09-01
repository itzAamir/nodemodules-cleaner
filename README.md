# NodeModules Cleaner

A cross-platform desktop application built with Tauri, React, and Tailwind CSS that helps you find and safely delete `node_modules` directories from your computer.

## Features

- **Multiple Scan Scopes**: Choose to scan a specific folder, drive, or entire computer
- **Real-time Scanning**: Results appear as they're discovered during scanning
- **Size Calculation**: Optional computation of directory sizes (slower but informative)
- **Safe Deletion**: Confirmation dialogs and safety checks before deletion
- **Bulk Operations**: Select and delete multiple `node_modules` directories at once
- **Cross-platform**: Works on Windows, macOS, and Linux
- **Modern UI**: Clean, responsive interface with dark/light mode support

## Screenshots

The app features a clean, modern interface with:
- Scope selection (Folder, Drive, or Entire Computer)
- Real-time progress tracking
- Results table with checkboxes for selection
- Confirmation modals for safe deletion
- Responsive design that works on different screen sizes

## Technology Stack

- **Backend**: Rust with Tauri 2.0
- **Frontend**: React 19 with TypeScript
- **Styling**: Tailwind CSS 4.0
- **Build Tool**: Vite
- **Cross-platform**: Tauri for native desktop apps

## Installation

### Prerequisites

- Node.js 18+ and pnpm
- Rust toolchain (for development)
- Tauri CLI

### Development Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd NodeModules-Cleaner
```

2. Install dependencies:
```bash
pnpm install
```

3. Start the development server:
```bash
pnpm tauri dev
```

### Building for Production

```bash
pnpm tauri build
```

This will create platform-specific installers in the `src-tauri/target/release/bundle/` directory.

## Usage

### 1. Choose Scan Scope

- **Folder**: Select a specific directory to scan
- **Drive**: Choose from available drives/volumes
- **Entire Computer**: Scan all mounted storage devices (may take a long time)

### 2. Configure Options

- **Compute Sizes**: Enable to show directory sizes (increases scan time)
- **Scan**: Start the scanning process

### 3. Review Results

- Results appear in real-time as they're discovered
- Use checkboxes to select items for deletion
- View project paths and node_modules locations
- See directory sizes if enabled

### 4. Delete Safely

- **Single Delete**: Click the delete button on any row
- **Bulk Delete**: Select multiple items and use "Delete selected"
- All deletions require confirmation
- Failed deletions are reported with error details

## Safety Features

- **Path Validation**: Only deletes directories named exactly `node_modules`
- **Confirmation Dialogs**: Required for all deletion operations
- **Error Handling**: Graceful handling of permission errors and locked files
- **No Data Upload**: All operations are local to your computer

## Cross-Platform Behavior

### Windows
- Detects drives (C:, D:, etc.)
- Uses Windows Explorer for folder operations
- Handles Windows-specific path formats

### macOS
- Detects mounted volumes in `/Volumes`
- Uses Finder for folder operations
- Skips system directories like `/proc`, `/sys`, `/dev`

### Linux
- Detects mounted volumes in `/media` and `/mnt`
- Uses default file manager for folder operations
- Skips virtual filesystem directories

## Development

### Project Structure

```
├── src/                    # React frontend
│   ├── App.tsx           # Main application component
│   ├── App.css           # Tailwind CSS imports
│   └── main.tsx          # React entry point
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── lib.rs        # Core Tauri commands
│   │   └── main.rs       # Application entry point
│   ├── Cargo.toml        # Rust dependencies
│   ├── tauri.conf.json   # Tauri configuration
│   └── capabilities/     # Security permissions
├── public/                # Static assets
└── package.json           # Node.js dependencies
```

### Key Components

- **Scan Engine**: Rust-based directory traversal with safety checks
- **Event System**: Real-time progress updates via Tauri events
- **UI Components**: React components for scope selection, results table, and modals
- **State Management**: React hooks for managing application state

### Adding New Features

1. **Backend**: Add new Tauri commands in `src-tauri/src/lib.rs`
2. **Frontend**: Create React components in `src/`
3. **Permissions**: Update `src-tauri/capabilities/default.json` if needed
4. **Configuration**: Modify `src-tauri/tauri.conf.json` for app settings

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on multiple platforms
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Security

- The app only accesses local filesystem
- No network requests are made
- All operations require explicit user confirmation
- Path validation prevents unauthorized deletions

## Support

For issues and questions:
- Check existing GitHub issues
- Create a new issue with detailed information
- Include your operating system and app version

## Roadmap

- [ ] Folder browser dialog integration
- [ ] Scan history and favorites
- [ ] Export scan results
- [ ] Scheduled scanning
- [ ] Advanced filtering options
- [ ] Performance optimizations for large scans
