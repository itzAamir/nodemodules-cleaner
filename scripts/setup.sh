#!/bin/bash

# NodeModules Cleaner - Development Setup Script

set -e

echo "🚀 Setting up NodeModules Cleaner development environment..."

# Check if required tools are installed
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo "❌ $1 is not installed. Please install it first."
        exit 1
    else
        echo "✅ $1 is installed"
    fi
}

echo "📋 Checking prerequisites..."
check_command "node"
check_command "yarn"
check_command "rustc"
check_command "cargo"

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
yarn install

# Install Rust dependencies
echo "🔧 Installing Rust dependencies..."
cd src-tauri
cargo fetch
cd ..

# Platform-specific setup
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "🐧 Setting up Linux dependencies..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y libwebkit2gtk-4.0-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
        elif command -v pacman &> /dev/null; then
        sudo pacman -S webkit2gtk gtk3 libayatana-appindicator-gtk3 librsvg
        elif command -v dnf &> /dev/null; then
        sudo dnf install webkit2gtk3-devel gtk3-devel libayatana-appindicator-gtk3-devel librsvg2-devel
    else
        echo "⚠️  Please install the required system dependencies manually:"
        echo "   - libwebkit2gtk-4.0-dev"
        echo "   - libgtk-3-dev"
        echo "   - libayatana-appindicator3-dev"
        echo "   - librsvg2-dev"
    fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 macOS detected - make sure Xcode Command Line Tools are installed"
    if ! xcode-select -p &> /dev/null; then
        echo "❌ Xcode Command Line Tools not found. Installing..."
        xcode-select --install
    else
        echo "✅ Xcode Command Line Tools are installed"
    fi
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
    echo "🪟 Windows detected - make sure Visual Studio Build Tools are installed"
    echo "   Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
fi

echo "🎉 Setup complete! You can now run:"
echo "   yarn dev          # Start development server"
echo "   yarn tauri:dev    # Start Tauri development mode"
echo "   yarn tauri:build  # Build the application"
