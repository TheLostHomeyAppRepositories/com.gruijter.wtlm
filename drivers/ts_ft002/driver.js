/*
Copyright 2021 - 2024, Robin de Gruijter (gruijter@hotmail.com)

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
  const byteArray = []; // array with decimal bytes
  while (dataArray.length) {
    const byte = dataArray.shift().concat(dataArray.shift());
    byteArray.push(parseInt(byte, 16));
  }
  const lastByte = byteArray.pop();
  let checksum = 0;
  // eslint-disable-next-line no-bitwise
  byteArray.forEach((byte) => {
    checksum ^= byte;
  });
  return checksum === lastByte;
};

const decode = (payload) => { // payload is array of bits
  try {
    // add sync, split in nibbles, reverse the nibbles, convert to hex string
    let data = 'af'; // always starts with 0xAF (sync). First part is thrown away by Homey SOF
    while (payload.length) {
      const nibble = payload.splice(0, 4).reverse();
      data += parseInt(nibble.join(''), 2).toString(16);
    }

    const info = {
      data,
      sof: parseInt(`${data[0]}${data[1]}`, 16), // Start of Frame always 0xAF
      randomID: parseInt(`${data[2]}${data[3]}`, 16), // changes after long power down
      msgType: parseInt(`${data[4]}${data[5]}`, 16), // always 17 (0x11) msgType https://bit.ly/3bivWLY, deviceID https://bit.ly/3bmGUzX
      airGap: parseInt(`${data[7]}${data[6]}${data[8]}`, 16), // in cm, range 0-1500, 5DC on invalid https://bit.ly/3ce3nPc
      temp: (parseInt(`${data[13]}${data[12]}${data[10]}`, 16) - 400) / 10, // in degrees celcius
      batState: parseInt(`${data[9]}`, 16), // always 8? 0 = OK, any other value = Low, https://bit.ly/3ce3nPc
      interval: parseInt(`${data[11]}`, 16), // always 0? Bit 7=0 180S, Bit 7 =1 30S, bit 4-6=1 5S https://bit.ly/3ce3nPc
      rain: parseInt(`${data[14]}${data[15]}`, 16), // always 0 (0x00) (https://bit.ly/3bivWLY)
      crc: parseInt(`${data[16]}${data[17]}`, 16), // crc-8 of bytes 0-7 including sof
      crcValid: checkCRC(data),
      // timestamp: Date.now(),
    };

    return Promise.resolve(info);
  } catch (error) {
    return Promise.reject(error);
  }
};

class MyDriver extends Homey.Driver {

  async onInit() {
    this.log('Driver has been initialized');
    this.discoveredDevices = {}; // discovered devices since app/driver start
    this.startReceiving().catch((error) => this.error(error));
  }

  makeDeviceList() {
    const capabilities = [
      'measure_temperature',
      'air_gap',
      'fill_ratio',
      'meter_water',
      'alarm_water',
      'alarm_battery',
    ];
    const devices = [
      {
        name: 'TS_FT002_anyID',
        data: {
          id: 'TS_FT002',
        },
        settings: {
          random_id: '256',
          ignore_id: true,
          ignore_out_of_range: true,
          tank_capacity: 200,
          max_air_gap: 80,
          min_air_gap: 25,
          alarm_level: 5,
        },
        capabilities,
      },
    ];
    Object.keys(this.discoveredDevices).forEach((id) => {
      const device = {
        name: `TS_FT002_${id}`,
        data: {
          id: `TS_FT002_${id}`,
        },
        settings: {
          random_id: id.toString(),
          ignore_id: false,
          ignore_out_of_range: true,
          tank_capacity: 200,
          max_air_gap: 80,
          min_air_gap: 25,
          alarm_level: 5,
        },
        capabilities,
      };
      devices.push(device);
    });
    return Promise.resolve(devices);
  }

  // eslint-disable-next-line class-methods-use-this
  async onPairListDevices() {
    return this.makeDeviceList();
  }

  async onRepair(session, device) {
    this.log('Repairing of device started', device.getName());
    let selectedDevices = [];
    session.setHandler('list_devices', () => {
      const devices = [];
      Object.keys(this.discoveredDevices).forEach((id) => {
        const device = {
          name: `ID:${id} airGap:${this.discoveredDevices[id].airGap} temp:${this.discoveredDevices[id].temp}`,
          data: {
            id: `TS_FT002_REPAIR${id}`,
          },
          settings: {
            random_id: id.toString(),
          },
        };
        devices.push(device);
      });
      return Promise.resolve(devices);
    });
    session.setHandler('list_devices_selection', (devices) => {
      selectedDevices = devices;
    });
    session.setHandler('showView', async (viewId) => {
      if (viewId === 'loading') {
        const [dev] = selectedDevices;
        if (!dev || !dev.settings) {
          await session.showView('done');
          throw Error('Device is corrupt!');
        }
        const newSettings = {
          random_id: dev.settings.random_id,
        };
        this.log('old settings:', device.getSettings());
        await device.setSettings(newSettings).catch(this.error);
        await session.showView('done');
        this.log('new settings:', device.getSettings());
        device.restartDevice().catch(this.error);
      }
    });
    session.setHandler('disconnect', () => {
      this.log('Repairing of device ended', device.getName());
    });
  }

  async startReceiving() {
    try {
      // register signal and start listening to data by enabling receive
      const mySignal = this.homey.rf.getSignal433('ts_ft002');
      await mySignal.enableRX();
      mySignal.on('payload', async (payload) => { // payload, first
        // check for shifted payload
        while (payload.length > 64) {
          this.log('Shifting payload');
          payload.shift(); // remove first bit
        }

        const info = await decode(payload);
        if (!info.crcValid) {
          this.log('CRC failed');
          return;
        }

        // log first data from new device
        if (!this.discoveredDevices[info.randomID]) {
          this.log('First data received from device:', info);
        }

        // update discovered devices
        this.discoveredDevices[info.randomID] = info;

        // emit info to homey device instances
        this.homey.emit('infoReceived', info);

        // anomaly check
        // if (checkCRC(data) && (info.msgType !== 17 || info.interval !== 0
        //  || info.rain !== 0 || info.batState !== 8)) this.log('Anomaly:', info);
      });
    } catch (error) {
      this.error(error.message);
    }
  }

}

module.exports = MyDriver;
