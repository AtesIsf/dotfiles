# Dotfiles

Modular configuration managed with **[GNU Stow](https://www.gnu.org/software/stow/)**.

## Overview

Configurations are organized into independent modular packages targeting `$HOME`:

| Package | Target | Description |
| :--- | :--- | :--- |
| `fish` | `~/.config/fish` | Fish shell configuration |
| `foot` | `~/.config/foot` | Foot terminal emulator & Nordic theme |
| `nvim` | `~/.config/nvim` | Neovim configuration |
| `sway` | `~/.config/sway` | Sway Wayland compositor config |
| `waybar` | `~/.config/waybar` | Waybar status bar config & style |
| `swaylock` | `~/.config/swaylock` | Swaylock configuration |
| `rofi` | `~/.config/rofi` | Rofi launcher configuration |
| `dunst` | `~/.config/dunst` | Dunst notification daemon |
| `gtk` | `~/.config/gtk-{3,4}.0` | GTK 3 & GTK 4 dark Nordic theme settings |
| `scripts` | `~/Scripts` | User utility scripts (wallpaper randomizer) |
| `pi` | `~/.pi/agent` | Pi agent settings, prompts, extensions, and skills |

## Requirements

Ensure GNU Stow is installed:
```bash
sudo pacman -S stow
```

## Quick Start

### 1. Install all configurations
Run the installer to stow all packages (conflicting files will be safely moved to `~/.dotfiles_backup/`):
```bash
./install.sh
```

### 2. Install specific packages
```bash
./install.sh sway waybar foot
```

### 3. Dry-run mode
Check what links would be created without making changes:
```bash
./install.sh --dry-run
```

## Manual GNU Stow Usage

You can also use Stow directly from the repository root:
```bash
# Link all packages
stow -t ~ */

# Link a single package
stow -t ~ nvim

# Unlink a package
stow -D -t ~ nvim
```

## Security & Privacy Note

This repository intentionally ignores:
- `auth.json` and session history (`~/.pi/agent/auth.json`, `~/.pi/agent/sessions/`)
- Git credentials (`~/.git-credentials`)
- SSH/GPG keys
- Shell history and runtime environment variables (`fish_variables`)
