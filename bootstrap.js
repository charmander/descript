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

function whitelistAction(hostSpec) {
	return function () {
		const newWhitelist =
			whitelist.concat([hostSpec]);

		extensionPreferences.setCharPref(
			'whitelist',
			newWhitelist.join(' ')
		);
	};
}

function blacklistAction(hostSpec) {
	return function () {
		const newWhitelist =
			whitelist.filter(existingUri => existingUri !== hostSpec);

		extensionPreferences.setCharPref(
			'whitelist',
			newWhitelist.join(' ')
		);
	};
}

function hostOnlyFor(uri) {
	const hostOnly = uri.clone();
	hostOnly.path = '';
	hostOnly.port = -1;
	hostOnly.ref = '';
	hostOnly.userPass = '';

	return hostOnly;
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

	function updateActions() {
		const currentHosts = new Set();

		function addToggle(uri) {
			const mainButton = window.document.getElementById('descript-button');
			const isMenu = mainButton.getAttribute('cui-areatype') === 'menu-panel';

			if (!uri.schemeIs('http') && !uri.schemeIs('https')) {
				return;
			}

			const hostOnly = hostOnlyFor(uri);
			const hostSpec = hostOnly.spec;

			if (currentHosts.has(hostSpec)) {
				return;
			}

			if (whitelist.indexOf(hostSpec) === -1) {
				let button = addActionButton(`Add ${hostOnly.spec}${isMenu ? '' : ' to whitelist'}`);
				button.classList.add('descript-whitelist-add');
				button.addEventListener('command', whitelistAction(hostSpec));
			} else {
				let button = addActionButton(`Remove ${hostOnly.spec}${isMenu ? '' : ' from whitelist'}`);
				button.classList.add('descript-whitelist-remove');
				button.addEventListener('command', blacklistAction(hostSpec));
			}

			currentHosts.add(hostSpec);
		}

		const page = window.getBrowser().selectedBrowser;
		const pageUri = page.registeredOpenURI;
		let child;

		while ((child = panelContent.firstChild)) {
			panelContent.removeChild(child);
		}

		if (!pageUri) {
			const placeholder = window.document.createElementNS(XUL_NS, 'label');
			placeholder.setAttribute('value', 'No domains eligible for whitelist.');
			panelContent.appendChild(placeholder);
			return;
		}

		addToggle(pageUri);

		const contentDocument = page.contentWindow.document;
		const scripts = contentDocument.getElementsByTagName('script');

		for (let script of scripts) {
			if (script.src) {
				addToggle(Services.io.newURI(script.src, null, null));
			}
		}
	}

	window.CustomizableUI.createWidget({
		id: 'descript-button',
		type: 'view',
		viewId: 'descript-manage',
		tooltiptext: 'Manage script whitelist',
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
