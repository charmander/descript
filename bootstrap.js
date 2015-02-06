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

	const ssm = Services.scriptSecurityManager;

	if (ssm.domainPolicyActive) {
		Components.utils.reportError('Domain policy already active.');
		return;
	}

	scriptsInitiallyEnabled = scriptPreferences.getBoolPref('enabled');
	scriptPreferences.setBoolPref('enabled', false);

	domainPolicy = ssm.activateDomainPolicy();
	reloadWhitelist();

	extensionPreferences.addObserver('whitelist', reloadWhitelist, false);
}

function shutdown() {
	if (!domainPolicy) {
		return;
	}

	extensionPreferences.removeObserver('whitelist', reloadWhitelist);
	domainPolicy.deactivate();
	scriptPreferences.setBoolPref('enabled', scriptsInitiallyEnabled);
}

function install() {
}

function uninstall() {
}
