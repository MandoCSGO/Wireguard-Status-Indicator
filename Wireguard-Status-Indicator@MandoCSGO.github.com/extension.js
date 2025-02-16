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

const GETTEXT_DOMAIN = 'Wireguard-Status-Indicator';

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
    constructor(type, extension) {
        this._type = type;
        this.extension = extension;
    }

    _getWireguardConnections(client) {
        return client.get_connections().filter(item => item.is_type(this._type));
    }

    _getDeviceListNames(client) {
        return client.get_devices().map(item => item.get_iface());
    }

    _createSwitches(menu, client, icon) {
        let connections = this._getWireguardConnections(client);
        connections.forEach(connection => this._addSwitch(menu, client, connection, icon));
        this._updateIcon(client, icon);
    }

    _createNewSwitches(menu, client, connection, icon) {
        this._addSwitch(menu, client, connection, icon);
    }

    _addSwitch(menu, client, connection, icon) {
        if (connection.is_type(this._type)) {
            let item = new PopupMenu.PopupSwitchMenuItem(_(connection.get_id()), false);
            item.set_name(connection.get_id());
            item._iface = connection.get_interface_name();
            item._connection = connection;

            connection.get_setting_connection().autoconnect = false;
            connection.commit_changes_async(true, null, null);

            let state = this._getDeviceListNames(client).includes(connection.get_interface_name());
            item.setToggleState(state);

            this._createSwitchConnections(item, client, connection, icon, menu);
            menu.addMenuItem(item, 0);
        }
    }

    _updateSwitches(menu, client, connection, icon) {
        if (connection.get_connection_type() === 'wireguard') {
            menu._getMenuItems().forEach(item => {
                if (item._connection === connection) {
                    item.destroy();
                }
            });
            this._updateIcon(client, icon);
        }
    }

    _updateSwitchesToggleState(menu, client, device, icon) {
        if (device.get_type_description() === 'wireguard') {
            menu._getMenuItems().forEach(item => {
                if (item._iface === device.get_iface()) {
                    item.setToggleState(this._getDeviceListNames(client).includes(item._iface));
                }
            });
            this._updateIcon(client, icon);
        }
    }

    _createSwitchConnections(item, client, connection, icon, menu) {
        item.connect('activate', () => {
            if (item._switch.state) {
                client.activate_connection_async(connection, null, null, null, null);
            } else {
                client.get_active_connections().forEach(activeConnection => {
                    if (activeConnection.get_id() === connection.get_id()) {
                        client.deactivate_connection_async(activeConnection, null, null);
                    }
                });
            }
        });
    }

    _updateIcon(client, icon) {
        if (!this.extension) {
            log("Warning: extension instance is missing in NMConnectionWireguard");
            return;
        }

        let devices = client.get_devices().filter(device => device.get_type_description() === 'wireguard');
        let iconPath = `${this.extension.path}/icons/`;
        let transitionIcons = devices.length > 0
            ? ["lock-1.svg", "lock-2.svg", "lock-3.svg", "lock-4.svg", "lock-5.svg", "lock-6.svg", "lock-7.svg", "lock-8.svg", "lock-9.svg"]
            : ["lock-9.svg", "lock-8.svg", "lock-7.svg", "lock-6.svg", "lock-5.svg", "lock-4.svg", "lock-3.svg", "lock-2.svg", "lock-1.svg"];

        let index = 0;
        const animateIcon = () => {
            if (index < transitionIcons.length) {
                icon.gicon = Gio.icon_new_for_string(iconPath + transitionIcons[index]);
                index++;
                this._iconTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, animateIcon);
                return GLib.SOURCE_CONTINUE;
            }
            return GLib.SOURCE_REMOVE;
        };

        if (this._iconTimeout) {
            GLib.source_remove(this._iconTimeout);
        }
        this._iconTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, animateIcon);
    }
}

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(client, WireGuard, extension) {
            super._init(0.0, _('Wireguard-Status-Indicator'));

            this.settings = extension.getSettings('org.gnome.shell.extensions.Wireguard-Status-Indicator@MandoCSGO.github.com');
            let icon = new St.Icon({ style_class: 'system-status-icon', icon_size: 16 });
            icon.gicon = Gio.icon_new_for_string(`${extension.path}/icons/lock-1.svg`);
            this.add_child(icon);

            WireGuard._createSwitches(this.menu, client, icon);
            client.connect('connection-added', (_client, _connection) => WireGuard._createNewSwitches(this.menu, client, _connection, icon));
            client.connect('connection-removed', (_client, _connection) => WireGuard._updateSwitches(this.menu, client, _connection, icon));
            client.connect('device-added', (_client, _device) => WireGuard._updateSwitchesToggleState(this.menu, client, _device, icon));
            client.connect('device-removed', (_client, _device) => WireGuard._updateSwitchesToggleState(this.menu, client, _device, icon));

            let settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
            settingsItem.connect('activate', () => extension.openPreferences());
            this.menu.addMenuItem(settingsItem);
        }
    }
);

export default class WireguardExtension extends Extension {
    enable() {
        this.client = NM.Client.new(null);
        this.WireGuard = new NMConnectionWireguard(NMConnectionCategory.WIREGUARD, this);
        this._indicator = new Indicator(this.client, this.WireGuard, this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

function init(meta) {
    return new WireguardExtension(meta.uuid);
}
