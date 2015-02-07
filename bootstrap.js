/* exported startup, shutdown, install, uninstall */

'use strict';

const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

Components.utils.import('resource://gre/modules/Services.jsm');

const scriptPreferences = Services.prefs.getBranch('javascript.');
const extensionPreferences = Services.prefs.getBranch('extensions.descript.');

let domainPolicy = null;
let whitelist;
let scriptsInitiallyEnabled;

function reloadWhitelist() {
	whitelist =
		extensionPreferences.getCharPref('whitelist').match(/\S+/g) || [];

	domainPolicy.whitelist.clear();

	for (let uri of whitelist) {
		domainPolicy.whitelist.add(Services.io.newURI(uri, null, null));
	}
}

function whitelistAction(uri) {
	return function () {
		const newWhitelist =
			whitelist.concat([uri.spec]);

		extensionPreferences.setCharPref(
			'whitelist',
			newWhitelist.join(' ')
		);
	};
}

function blacklistAction(uri) {
	return function () {
		const newWhitelist =
			whitelist.filter(existingUri => existingUri !== uri.spec);

		extensionPreferences.setCharPref(
			'whitelist',
			newWhitelist.join(' ')
		);
	};
}

function addButton(window) {
	if (!window.CustomizableUI) {
		return;
	}

	const panelView = window.document.createElementNS(XUL_NS, 'panelview');
	panelView.setAttribute('id', 'descript-manage');
	panelView.setAttribute('flex', '1');
	panelView.classList.add('PanelUI-subView');

	const panelHeader = window.document.createElementNS(XUL_NS, 'label');
	panelHeader.classList.add('panel-subview-header');
	panelHeader.setAttribute('value', 'Manage whitelist');

	const panelContent = window.document.createElementNS(XUL_NS, 'vbox');
	panelContent.classList.add('panel-subview-body');

	const panelParent = window.document.getElementById('PanelUI-multiView');

	panelView.appendChild(panelHeader);
	panelView.appendChild(panelContent);
	panelParent.appendChild(panelView);

	function addActionButton(label) {
		const actionButton = window.document.createElementNS(XUL_NS, 'toolbarbutton');
		actionButton.classList.add('subviewbutton');
		actionButton.setAttribute('label', label);
		panelContent.appendChild(actionButton);

		return actionButton;
	}

	function addToggle(uri) {
		if (!uri.schemeIs('http') && !uri.schemeIs('https')) {
			return;
		}

		const hostOnly = uri.clone();
		hostOnly.path = '';
		hostOnly.port = -1;
		hostOnly.ref = '';
		hostOnly.userPass = '';

		if (whitelist.indexOf(hostOnly.spec) === -1) {
			addActionButton(`Add ${hostOnly.spec} to whitelist`)
				.addEventListener('command', whitelistAction(hostOnly));
		} else {
			addActionButton(`Remove ${hostOnly.spec} from whitelist`)
				.addEventListener('command', blacklistAction(hostOnly));
		}
	}

	function updateActions() {
		const pageUri = window.getBrowser().selectedBrowser.registeredOpenURI;
		let child;

		while ((child = panelContent.firstChild)) {
			panelContent.removeChild(child);
		}

		if (pageUri) {
			addToggle(pageUri);
		}

		if (!panelContent.childNodes.length) {
			const placeholder = window.document.createElementNS(XUL_NS, 'label');
			placeholder.setAttribute('value', 'No domains eligible for whitelist.');
			panelContent.appendChild(placeholder);
		}
	}

	window.CustomizableUI.createWidget({
		id: 'descript-button',
		type: 'view',
		viewId: 'descript-manage',
		tooltiptext: 'Manage script whitelist for current page',
		label: 'Descript',
		onViewShowing: updateActions,
	});
}

function removeButton(window) {
	if (!window.CustomizableUI) {
		return;
	}

	window.CustomizableUI.destroyWidget('descript-button');
	window.document.getElementById('descript-manage').remove();
}

function whenLoaded(window, callback) {
	window.addEventListener('load', function loaded() {
		window.removeEventListener('load', loaded, false);
		callback(window);
	}, false);
}

function eachWindow(callback) {
	const windowEnumerator = Services.wm.getEnumerator('navigator:browser');

	while (windowEnumerator.hasMoreElements()) {
		const domWindow = windowEnumerator.getNext();

		if (domWindow.document.readyState === 'complete') {
			callback(domWindow);
		} else {
			whenLoaded(domWindow, callback);
		}
	}
}

const windowObserver = {
	observe: function observe(subject, topic) {
		if (topic === 'domwindowopened') {
			whenLoaded(subject, addButton);
		}
	}
};

function startup() {
	Services.prefs
		.getDefaultBranch('extensions.descript.')
		.setCharPref('whitelist', '');

	domainPolicy = Services.scriptSecurityManager.activateDomainPolicy();

	scriptsInitiallyEnabled = scriptPreferences.getBoolPref('enabled');
	scriptPreferences.setBoolPref('enabled', false);

	extensionPreferences.addObserver('whitelist', reloadWhitelist, false);
	reloadWhitelist();

	Services.ww.registerNotification(windowObserver);
	eachWindow(addButton);
}

function shutdown() {
	if (!domainPolicy) {
		return;
	}

	extensionPreferences.removeObserver('whitelist', reloadWhitelist);
	scriptPreferences.setBoolPref('enabled', scriptsInitiallyEnabled);
	domainPolicy.deactivate();

	Services.ww.unregisterNotification(windowObserver);
	eachWindow(removeButton);
}

function install() {
}

function uninstall() {
}
