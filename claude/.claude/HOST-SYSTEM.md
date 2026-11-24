# Host System

Public file (dotfiles repo): no names, emails, hostnames, keys or paths
that reveal private data.

## Philosophy

Minimal, source-based, no bloat. Every package goes through the system
package manager; nothing is installed behind its back.

## System

- OS: Gentoo Linux, amd64, profile `default/linux/amd64/23.0`
- Init: OpenRC (no systemd; elogind for sessions)
- Kernel: custom-built
- CPU: AMD Ryzen 5 7640U (Zen 4), 12 threads
- Compiler flags: `-march=znver4 -O2 -pipe`
- Key USE: `wayland vulkan pipewire elogind networkmanager`
  and `-X -xwayland -systemd -pulseaudio -gnome -kde -telemetry`

## Desktop

- Compositor: sway (Wayland only, no XWayland), waybar, rofi, dunst
- Terminal: foot; shell: fish (login), bash for scripts
- Editor: Neovim (lazy.nvim), `colorcolumn=80`
- Browser: LibreWolf

## Toolchains

gcc, clang (LLVM 22), python3, rustc/cargo, node: all from Portage.
LSPs and debug adapters: Mason (`~/.local/share/nvim/mason/bin`).

## Installing things

Never pip/cargo/npm/curl-install anything yourself. Tell the user which
of these to use, in order of preference:

1. Portage: give the atom (e.g. `dev-util/foo`) to `emerge`.
2. `flatpak --user`: for proprietary software that can't be compiled.
3. `~/.local/bin`: hand-installed exceptions (only Claude Code now).
   Last resort, the user's call.
