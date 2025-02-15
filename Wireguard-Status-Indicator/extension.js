/* extension.js
 *
 * https://github.com/MandoCSGO/Wireguard-Status-Indicator
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

const GETTEXT_DOMAIN = 'wireguard-status-indicator';

import GObject from 'gi://GObject';
import St from 'gi://St';
import NM from 'gi://NM';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const NMConnectionCategory = {
    WIREGUARD: 'wireguard',
};

class NMConnectionWireguard {
    constructor(type) {
        this._type = type;
    }

    _get_wireguard_connections(client) {
        return client.get_connections().filter(item => item.is_type(this._type));
    }

    _get_device_list_names(client) {
        return client.get_devices().map(item => item.get_iface());
    }

    _create_switches(menu, client, icon) {
        let connections = this._get_wireguard_connections(client);
        connections.forEach(connection => {
            this._add_switch(menu, client, connection, icon);
        });
        this._update_icon(client, icon);
    }

    _create_new_switches(menu, client, connection, icon) {
        this._add_switch(menu, client, connection, icon);
    }

    _add_switch(menu, client, connection, icon) {
        if (connection.is_type(this._type)) {
            let item = new PopupMenu.PopupSwitchMenuItem(_(connection.get_id()), false);
            item.set_name(connection.get_id());
            item._iface = connection.get_interface_name();
            item._connection = connection;

            connection.get_setting_connection().autoconnect = false;
            connection.commit_changes_async(true, null, null);

            let deviceListNames = this._get_device_list_names(client);
            let state = deviceListNames.includes(connection.get_interface_name());
            item.setToggleState(state);

            this._create_switch_connections(item, client, connection, icon, menu);
            menu.addMenuItem(item, 0);
        }
    }

    _update_switches(menu, client, connection, icon) {
        if (connection.get_connection_type() === 'wireguard') {
            let items = menu._getMenuItems();
            items.forEach(item => {
                if (item._connection === connection) {
                    item.destroy();
                }
            });
            this._update_icon(client, icon);
        }
    }

    _update_switches_toggle_state(menu, client, device, icon) {
        if (device.get_type_description() === 'wireguard') {
            let items = menu._getMenuItems();
            items.forEach(item => {
                if (item._iface === device.get_iface()) {
                    let deviceListNames = this._get_device_list_names(client);
                    let state = deviceListNames.includes(item._iface);
                    item.setToggleState(state);
                }
            });
            this._update_icon(client, icon);
        }
    }

    _create_switch_connections(item, client, connection, icon, menu) {
        item.connect('activate', () => {
            if (item._switch.state) {
                client.activate_connection_async(connection, null, null, null, null);
            } else {
                let activeConnections = client.get_active_connections();
                activeConnections.forEach(activeConnection => {
                    if (activeConnection.get_id() === connection.get_id()) {
                        client.deactivate_connection_async(activeConnection, null, null);
                    }
                });
            }
        });
    }

    _update_icon(client, icon) {
        let devices = client.get_devices().filter(device => device.get_type_description() === 'wireguard');

        let extensionObject = Extension.lookupByUUID('wireguard-status-indicator');
        let iconPath = `${extensionObject.path}/icons/`;

        let transitionIcons = devices.length > 0
            ? ["lock-1.svg", "lock-2.svg", "lock-3.svg", "lock-4.svg", "lock-5.svg", "lock-6.svg", "lock-7.svg", "lock-8.svg", "lock-9.svg"]
            : ["lock-9.svg", "lock-8.svg", "lock-7.svg", "lock-6.svg", "lock-5.svg", "lock-4.svg", "lock-3.svg", "lock-2.svg", "lock-1.svg"];

        let index = 0;

        function animateIcon() {
            if (index < transitionIcons.length) {
                icon.gicon = Gio.icon_new_for_string(iconPath + transitionIcons[index]);
                index++;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, animateIcon);
            }
        }

        animateIcon();
    }
}

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(client, WireGuard) {
            super._init(0.0, _('Wireguard-extension'));

            let extensionObject = Extension.lookupByUUID('wireguard-status-indicator');
            this.settings = extensionObject.getSettings('org.gnome.shell.extensions.wireguard-status-indicator');

            let icon = new St.Icon({
                style_class: 'system-status-icon',
                icon_size: 16
            });
            icon.gicon = Gio.icon_new_for_string(`${extensionObject.path}/icons/lock-1.svg`);
            this.add_child(icon);

            WireGuard._create_switches(this.menu, client, icon);

            client.connect('connection-added', (_client, _connection) => {
                WireGuard._create_new_switches(this.menu, client, _connection, icon);
            });

            client.connect('connection-removed', (_client, _connection) => {
                WireGuard._update_switches(this.menu, client, _connection, icon);
            });

            client.connect('device-added', (_client, _device) => {
                WireGuard._update_switches_toggle_state(this.menu, client, _device, icon);
            });

            client.connect('device-removed', (_client, _device) => {
                WireGuard._update_switches_toggle_state(this.menu, client, _device, icon);
            });

            let settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
            settingsItem.connect('activate', () => {
                extensionObject.openPreferences();
            });
            this.menu.addMenuItem(settingsItem);
        }
    }
);

export default class WireguardExtension extends Extension {
    enable() {
        this.client = NM.Client.new(null);
        this.WireGuard = new NMConnectionWireguard(NMConnectionCategory.WIREGUARD);
        this._indicator = new Indicator(this.client, this.WireGuard);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this.client = null;
        this.WireGuard = null;
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new WireguardExtension(meta.uuid);
}
