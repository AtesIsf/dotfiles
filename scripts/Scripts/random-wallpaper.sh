#!/usr/bin/env bash
set -euo pipefail

WALLPAPER_DIR="$HOME/Pictures/Wallpapers"
DEST_FILE="$HOME/Pictures/Wallpapers/SELECTED"

# Ensure the source directory exists
if [[ ! -d "$WALLPAPER_DIR" ]]; then
    exit 1
fi

# Select a random file from ~/Pictures/Wallpapers (excluding the destination file)
# Works recursively for subfolders and safely handles spaces in filenames
RANDOM_FILE=$(find "$WALLPAPER_DIR" -type f ! -name "SELECTED" | shuf -n 1)

# Check if a file was found
if [[ -z "$RANDOM_FILE" ]]; then
    exit 1
fi

# Copy the selected file to ~/Pictures/Wallpapers/SELECTED
cp "$RANDOM_FILE" "$DEST_FILE"


