# default: /usr/share/cachyos-fish-config/cachyos-config.fish
# overwrite greeting
# potentially disabling fastfetch
function fish_greeting
    # smth smth
end

fish_vi_key_bindings
fish_add_path ~/.pi/agent/bin

function ls --wraps=eza
    if command -q eza
        set -l args --color=always --icons=always --group-directories-first --git
        for arg in $argv
            switch $arg
                case -R --recursive
                    set -a args --tree
                case '*'
                    set -a args $arg
            end
        end
        command eza $args
    else
        command ls --color=auto $argv
    end
end
alias grep='grep --color=auto'
