#!/usr/bin/env bash
# Network icon for waybar: shield when a VPN is up, otherwise wifi/ethernet/disconnected.
# Prints JSON on every NetworkManager change, and every 10s to refresh signal strength.

print() {
    local active vpn wifi eth dev text class tip
    active=$(nmcli -t -f TYPE,NAME,DEVICE con show --active)
    vpn=$(awk -F: '$1=="vpn"{print $2; exit}' <<<"$active")
    wifi=$(awk -F: '$1=="802-11-wireless"{print $2; exit}' <<<"$active")
    eth=$(awk -F: '$1=="802-3-ethernet"{print $3; exit}' <<<"$active")

    if [[ -n $wifi ]]; then
        dev=$(awk -F: '$1=="802-11-wireless"{print $3; exit}' <<<"$active")
        local signal
        signal=$(nmcli -t -f IN-USE,SIGNAL dev wifi list --rescan no | awk -F: '$1=="*"{print $2; exit}')
        text=""; class="wifi"
        tip="SSID: $wifi\nSignal: ${signal}%\nIP: $(nmcli -g IP4.ADDRESS dev show "$dev" | head -1 | cut -d/ -f1)"
    elif [[ -n $eth ]]; then
        text="󰈀"; class="ethernet"
        tip="Interface: $eth\nIP: $(nmcli -g IP4.ADDRESS dev show "$eth" | head -1 | cut -d/ -f1)"
    else
        text="󰤮"; class="disconnected"; tip="Disconnected"
    fi

    if [[ -n $vpn ]]; then
        text="󰦝"; class="vpn"
        tip="VPN: ${vpn%.protonvpn.udp}\n$tip"
    fi

    jq -nc --arg t "$text" --arg c "$class" --arg tip "$tip" \
        '{text: $t, class: $c, tooltip: ($tip | gsub("\\\\n"; "\n"))}'
}

print
while true; do
    read -r -t 10 _ || true
    print
done < <(nmcli monitor)
