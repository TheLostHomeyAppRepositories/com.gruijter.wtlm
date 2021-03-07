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

// CRC-8 expects hex string as input, e.g. 'afbb1190288052006f'
const checkCRC = (data) => {
	const dataArray = data.split('');
	const byteArray = [];	// array with decimal bytes
	while (dataArray.length) {
		const byte = dataArray.shift().concat(dataArray.shift());
		byteArray.push(parseInt(byte, 16));
	}
	const lastByte = byteArray.pop();
	let checksum = 0;
	// eslint-disable-next-line no-bitwise
	byteArray.forEach((byte) => { checksum ^= byte; });
	return checksum === lastByte;
};

class MyDriver extends Homey.Driver {

	async onInit() {
		this.log('Driver has been initialized');
		this.discoveredIDs = [];	// discovered devices since app/driver start
		this.startReceiving();
	}

	// eslint-disable-next-line class-methods-use-this
	async onPairListDevices() {
		return [
			{
				name: 'TS_FT002',
				data: {
					id: 'TS_FT002',
				},
				settings: {
					tank_capacity: 200,
					max_air_gap: 80,
					min_air_gap: 15,
					alarm_level: 5,
				},
				capabilities: [
					'measure_temperature',
					'air_gap',
					'fill_ratio',
					'meter_water',
					'alarm_water',
					'alarm_battery',
				],
			},
		];
	}

	async decode(payload) {	// payload is bitstring
		try {
			if (payload.length !== 68) {
				if (this.discoveredIDs.length === 0) this.error('Unknown device data received:', payload);
				throw Error('invalid message length received');
			}

			// add sync, split in nibbles, reverse the nibbles, convert to hex string
			let data = 'a'; // always starts with 0xAF (sync). First part is thrown away by Homey SOF
			while (payload.length) {
				const nibble = payload.splice(0, 4).reverse();
				data += parseInt(nibble.join(''), 2).toString(16);
			}

			const info = {
				data,
				sof: parseInt(`${data[0]}${data[1]}`, 16),	// Start of Frame always 0xAF
				randomID: parseInt(`${data[2]}${data[3]}`, 16),	// changes after long power down
				msgType: parseInt(`${data[4]}${data[5]}`, 16), // always 17 (0x11) msgType https://bit.ly/3bivWLY, deviceID https://bit.ly/3bmGUzX
				airGap: parseInt(`${data[7]}${data[6]}${data[8]}`, 16),	// in cm, range 0-1500, 5DC on invalid https://bit.ly/3ce3nPc
				temp: (parseInt(`${data[13]}${data[12]}${data[10]}`, 16) - 400) / 10,	// in degrees celcius
				batState: parseInt(`${data[9]}`, 16), // always 8? 0 = OK, any other value = Low, https://bit.ly/3ce3nPc
				interval: parseInt(`${data[11]}`, 16), // always 0? Bit 7=0 180S, Bit 7 =1 30S, bit 4-6=1 5S https://bit.ly/3ce3nPc
				rain: parseInt(`${data[14]}${data[15]}`, 16), // always 0 (0x00) (https://bit.ly/3bivWLY)
				crc: parseInt(`${data[16]}${data[17]}`, 16), // crc-8 of bytes 0-7 including sof
			};

			if (!checkCRC(data)) {
				if (this.discoveredIDs.length === 0) this.error('Unknown device data received, but CRC fails:', info);
				throw Error('CRC failed');
			}

			// log first data from new device, and add to discovered devices
			if (!this.discoveredIDs.includes(info.randomID)) {
				this.log('First data received from device:', info);
				this.discoveredIDs.push(info.randomID);
			}

			if (checkCRC(data) && (info.sof !== 175 || info.msgType !== 17 || info.interval !== 0
				|| info.rain !== 0 || info.batState !== 8)) this.error('SOMETHING IS DIFFERENT!', info);

			return info;
		} catch (error) {
			return this.error(error.message);
		}
	}

	async startReceiving() {
		try {

			// register signal and start listening to data by enabling receive
			const mySignal = this.homey.rf.getSignal433('ts_ft002');
			await mySignal.enableRX();

			mySignal.on('payload', async (payload, first) => {
				const info = await this.decode(payload);
				if (info) this.homey.emit('infoReceived', info);
			});

		} catch (error) {
			this.error(error.message);
		}

	}

}

module.exports = MyDriver;
