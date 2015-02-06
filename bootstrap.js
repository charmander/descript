/* exported startup, shutdown, install, uninstall */

'use strict';

Components.utils.import('resource://gre/modules/Services.jsm');

const scriptPreferences = Services.prefs.getBranch('javascript.');
const extensionPreferences = Services.prefs.getBranch('extensions.descript.');

let domainPolicy = null;
let scriptsInitiallyEnabled;

function reloadWhitelist() {
	let whitelist =
		extensionPreferences.getCharPref('whitelist').match(/\S+/g);

	domainPolicy.whitelist.clear();

	if (!whitelist) {
		return;
	}

	for (let uri of whitelist) {
		domainPolicy.whitelist.add(Services.io.newURI(uri, null, null));
	}
}

function startup() {
	Services.prefs
		.getDefaultBranch('extensions.descript.')
		.setCharPref('whitelist', '');

	domainPolicy = Services.scriptSecurityManager.activateDomainPolicy();

	scriptsInitiallyEnabled = scriptPreferences.getBoolPref('enabled');
	scriptPreferences.setBoolPref('enabled', false);

	extensionPreferences.addObserver('whitelist', reloadWhitelist, false);
	reloadWhitelist();
}

function shutdown() {
	if (!domainPolicy) {
		return;
	}

	extensionPreferences.removeObserver('whitelist', reloadWhitelist);
	scriptPreferences.setBoolPref('enabled', scriptsInitiallyEnabled);
	domainPolicy.deactivate();
}

function install() {
}

function uninstall() {
}
