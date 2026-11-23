#!/usr/bin/env bash
set -euo pipefail

WALLPAPER_DIR="$HOME/Pictures/Wallpapers"
DEST_FILE="$WALLPAPER_DIR/SELECTED"

# Ensure the source directory exists
if [[ ! -d "$WALLPAPER_DIR" ]]
then
    exit 1
fi

# Select a random image file (excluding the destination file)
RANDOM_FILE=$(find "$WALLPAPER_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) ! -name "SELECTED" | shuf -n 1)

# Check if a file was found
if [[ -z "$RANDOM_FILE" ]]
then
    exit 1
fi

# Copy the selected file to SELECTED for reference
cp "$RANDOM_FILE" "$DEST_FILE"

# Apply dynamically via swaymsg
if [[ -n "${SWAYSOCK:-}" ]]
then
    swaymsg "output * bg \"$RANDOM_FILE\" fill"
fi
