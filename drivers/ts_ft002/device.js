/*
Copyright 2021, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.wtlm.

com.gruijter.wtlm is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.wtlm is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.wtlm. If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

const Homey = require('homey');

class MyDevice extends Homey.Device {

	async onInit() {
		this.log(`device ready: ${this.getName()}`);

		this.homey.on('infoReceived', (info) => {
			this.handleInfo(info);
		});
	}

	async onAdded() {
		this.log(`${this.getData().id} added: ${this.getName()}`);
	}

	/**
	 * onSettings is called when the user updates the device's settings.
	 * @param {object} event the onSettings event data
	 * @param {object} event.oldSettings The old settings object
	 * @param {object} event.newSettings The new settings object
	 * @param {string[]} event.changedKeys An array of keys changed since the previous version
	 * @returns {Promise<string|void>} return a custom message that will be displayed
	 */
	async onSettings({ oldSettings, newSettings, changedKeys }) {
		this.log('MyDevice settings where changed');
	}

	async onRenamed(name) {
		this.log('Device was renamed:', name);
	}

	async onDeleted() {
		this.log(`${this.getData().id} deleted: ${this.getName()}`);
	}

	setCapability(capability, value) {
		if (this.hasCapability(capability)) {
			this.setCapabilityValue(capability, value)
				.catch((error) => {
					this.log(error, capability, value);
				});
		}
	}

	async handleInfo(info) {
		const {
			tank_capacity: tankCapacity, max_air_gap: maxAirGap, min_air_gap: minAirGap, alarm_level: alarmLevel,
		} = this.getSettings();
		let fillRatio = Math.round(100 * ((maxAirGap - info.airGap) / (maxAirGap - minAirGap)));
		fillRatio = Math.sign(fillRatio) === 1 ? fillRatio : 0;
		const waterMeter = (fillRatio * tankCapacity) / 100000;	// in m3
		const waterAlarm = fillRatio < alarmLevel;
		const lowBat = info.batState !== 8;

		// trigger custom capability flow cards
		if (info.airGap !== this.getCapabilityValue('air_gap')) {
			this.homey.flow.getDeviceTriggerCard('air_gap_changed')
				.trigger(this, {})
				.catch(this.error);
		}

		// update capabilities
		this.setCapability('measure_temperature', info.temp);
		this.setCapability('air_gap', info.airGap);
		this.setCapability('fill_ratio', fillRatio);
		this.setCapability('meter_water', waterMeter);
		this.setCapability('alarm_water', waterAlarm);
		this.setCapability('alarm_battery', lowBat);
	}

}

module.exports = MyDevice;
