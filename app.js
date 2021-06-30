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
const Logger = require('./captureLogs.js');

class App extends Homey.App {
	/**
	 * onInit is called when the app is initialized.
	 */
	async onInit() {
		process.env.LOG_LEVEL = 'info'; // info or debug
		if (!this.logger) this.logger = new Logger({ name: 'log', length: 500, homey: this.homey });
		this.log('Wireless Tank Level Meter app is running...');

		// register some listeners
		process.on('unhandledRejection', (error) => {
			this.error('unhandledRejection! ', error.message);
		});
		process.on('uncaughtException', (error) => {
			this.error('uncaughtException! ', error);
		});
		this.homey
			.on('unload', () => {
				this.log('app unload called');
				// save logs to persistant storage
				this.logger.saveLogs();
			})
			.on('memwarn', () => {
				this.log('memwarn!');
			});
		// do garbage collection every 10 minutes
		// this.intervalIdGc = setInterval(() => {
		// 	global.gc();
		// }, 1000 * 60 * 10);

	}

	//  stuff for frontend API
	deleteLogs() {
		return this.logger.deleteLogs();
	}

	getLogs() {
		return this.logger.logArray;
	}

}

module.exports = App;
