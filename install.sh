#!/usr/bin/env bash
set -euo pipefail

# Directory where dotfiles repo lives
DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}"
BACKUP_DIR="${HOME}/.dotfiles_backup/$(date +%Y%m%d_%H%M%S)"

# List of available packages
ALL_PACKAGES=(
    dunst
    fish
    foot
    gtk
    nvim
    pi
    rofi
    scripts
    sway
    swaylock
    waybar
)

# Print helper
info() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }
error() { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }
success() { echo -e "\033[1;32m[OK]\033[0m $*"; }

# Check for GNU Stow
check_stow() {
    if ! command -v stow >/dev/null 2>&1; then
        error "GNU Stow is not installed."
        echo "Install it using: sudo pacman -S stow"
        exit 1
    fi
}

# Scan for conflicting files/symlinks and back them up safely
backup_conflicts() {
    local pkg="$1"
    local backed_up=0

    # Find relative file and symlink paths in package
    while IFS= read -r rel_file; do
        local dest_file="${TARGET_DIR}/${rel_file}"
        if [[ -e "$dest_file" || -L "$dest_file" ]]; then
            # If already pointing to the repository version, no conflict
            local current_target
            current_target="$(readlink -f "$dest_file" 2>/dev/null || true)"
            local repo_target
            repo_target="$(readlink -f "$DOTFILES_DIR/$pkg/$rel_file" 2>/dev/null || true)"

            if [[ -n "$current_target" && "$current_target" == "$repo_target" ]]; then
                continue
            fi

            if [[ $backed_up -eq 0 ]]; then
                mkdir -p "$BACKUP_DIR"
                backed_up=1
            fi
            local dest_dir
            dest_dir="$(dirname "$rel_file")"
            mkdir -p "${BACKUP_DIR}/${dest_dir}"
            warn "Backing up existing: $dest_file -> ${BACKUP_DIR}/${rel_file}"
            mv "$dest_file" "${BACKUP_DIR}/${rel_file}"
        fi
    done < <(cd "$DOTFILES_DIR/$pkg" && find . -mindepth 1 \( -type f -o -type l \) -printf "%P\n")
}

# Main installation
main() {
    local dry_run=0
    local target_packages=()

    for arg in "$@"; do
        case "$arg" in
            --dry-run|-n)
                dry_run=1
                ;;
            --help|-h)
                echo "Usage: ./install.sh [--dry-run|-n] [package1 package2 ...]"
                echo "Available packages: ${ALL_PACKAGES[*]}"
                exit 0
                ;;
            *)
                target_packages+=("$arg")
                ;;
        esac
    done

    check_stow

    if [[ ${#target_packages[@]} -eq 0 ]]; then
        target_packages=("${ALL_PACKAGES[@]}")
    fi

    info "Starting dotfiles setup with GNU Stow..."
    info "Source: $DOTFILES_DIR"
    info "Target: $TARGET_DIR"

    for pkg in "${target_packages[@]}"; do
        if [[ ! -d "$DOTFILES_DIR/$pkg" ]]; then
            warn "Package '$pkg' does not exist in repository. Skipping."
            continue
        fi

        info "Processing package: $pkg"

        if [[ $dry_run -eq 0 ]]; then
            backup_conflicts "$pkg"
            stow -v -R -d "$DOTFILES_DIR" -t "$TARGET_DIR" "$pkg"
        else
            stow -n -v -R -d "$DOTFILES_DIR" -t "$TARGET_DIR" "$pkg"
        fi
    done

    if [[ -d "$BACKUP_DIR" ]]; then
        info "Conflicting files were backed up safely to: $BACKUP_DIR"
    fi

    # Link agent skills if the repository exists
    if [[ -x "${TARGET_DIR}/Projects/agent-skills/scripts/link-pi.sh" ]]; then
        info "Linking agent-skills into ~/.pi/agent/skills..."
        "${TARGET_DIR}/Projects/agent-skills/scripts/link-pi.sh"
    fi

    success "Dotfiles installation complete!"
}

main "$@"
