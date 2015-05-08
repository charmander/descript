/* exported startup, shutdown, install, uninstall */

'use strict';

const { Services } = Components.utils.import('resource://gre/modules/Services.jsm', {});
const { XPCOMUtils } = Components.utils.import('resource://gre/modules/XPCOMUtils.jsm', {});

function uniqueBy(items, key) {
	const existingKeys = new Set();
	const result = [];

	for (let item of items) {
		const itemKey = key(item);

		if (!existingKeys.has(itemKey)) {
			existingKeys.add(itemKey);
			result.push(item);
		}
	}

	return result;
}

function empty(node) {
	let child;

	while ((child = node.firstChild)) {
		node.removeChild(child);
	}
}

function hostOnlyFor(uri) {
	const hostOnly = uri.clone();
	hostOnly.path = '';
	hostOnly.port = -1;
	hostOnly.ref = '';
	hostOnly.userPass = '';

	return hostOnly;
}

let domainPolicy;

const whitelist = (function () {
	let preference = [];

	function matchable(uri) {
		return uri.schemeIs('https') ||
			uri.schemeIs('http') ||
			uri.schemeIs('file');
	}

	function allows(uri) {
		return !matchable(uri) || domainPolicy.whitelist.contains(uri);
	}

	function add(uri) {
		if (matchable(uri)) {
			domainPolicy.whitelist.add(uri);
			preference.push(hostOnlyFor(uri).spec);
		}
	}

	function remove(uri) {
		domainPolicy.whitelist.remove(uri);

		const hostSpec = hostOnlyFor(uri).spec;
		preference = preference.filter(spec => spec !== hostSpec);
	}

	function loadPreference(preferenceString) {
		const newPreference = preferenceString.match(/\S+/g) || [];

		preference = [];
		domainPolicy.whitelist.clear();

		if (!newPreference) {
			return;
		}

		for (let spec of newPreference) {
			add(Services.io.newURI(spec, null, null));
		}
	}

	function getPreference() {
		return preference.join(' ');
	}

	return { matchable, allows, add, remove, loadPreference, getPreference };
})();

const { startup, shutdown } = (function () {
	const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

	const { nsIContentPolicy, nsIFactory } = Components.interfaces;

	const componentRegistrar =
		Components.manager
			.QueryInterface(Components.interfaces.nsIComponentRegistrar);

	const categoryManager =
		Components.classes['@mozilla.org/categorymanager;1']
			.getService(Components.interfaces.nsICategoryManager);

	const scriptPreferences = Services.prefs.getBranch('javascript.');
	const extensionPreferences = Services.prefs.getBranch('extensions.descript.');

	let scriptsInitiallyEnabled;

	function addButton(window) {
		if (!window.CustomizableUI) {
			return;
		}

		const document = window.document;

		const panelView = document.createElementNS(XUL_NS, 'panelview');
		panelView.setAttribute('id', 'descript-manage');
		panelView.setAttribute('flex', '1');
		panelView.classList.add('PanelUI-subView');

		const panelHeader = document.createElementNS(XUL_NS, 'label');
		panelHeader.classList.add('panel-subview-header');
		panelHeader.setAttribute('value', 'Manage whitelist');

		const panelContent = document.createElementNS(XUL_NS, 'vbox');
		panelContent.classList.add('panel-subview-body');

		const panelParent = document.getElementById('PanelUI-multiView');

		panelView.appendChild(panelHeader);
		panelView.appendChild(panelContent);
		panelParent.appendChild(panelView);

		function addActionButton(label) {
			const actionButton = document.createElementNS(XUL_NS, 'toolbarbutton');
			actionButton.classList.add('subviewbutton');
			actionButton.setAttribute('label', label);
			panelContent.appendChild(actionButton);

			return actionButton;
		}

		function whitelistAction(action, uri) {
			return function () {
				action.call(whitelist, uri);
				extensionPreferences.setCharPref('whitelist', whitelist.getPreference());
			};
		}

		function updateActions() {
			function addToggle(uri) {
				const mainButton = document.getElementById('descript-button');
				const isMenu = mainButton.getAttribute('cui-areatype') === 'menu-panel';

				if (whitelist.allows(uri)) {
					let button = addActionButton(`Remove ${uri.spec}${isMenu ? '' : ' from whitelist'}`);
					button.classList.add('descript-whitelist-remove');
					button.addEventListener('command', whitelistAction(whitelist.remove, uri));
				} else {
					let button = addActionButton(`Add ${uri.spec}${isMenu ? '' : ' to whitelist'}`);
					button.classList.add('descript-whitelist-add');
					button.addEventListener('command', whitelistAction(whitelist.add, uri));
				}
			}

			const page = window.getBrowser().selectedBrowser;
			const pageUri = page.registeredOpenURI;

			empty(panelContent);

			if (!pageUri || !whitelist.matchable(pageUri)) {
				const placeholder = document.createElementNS(XUL_NS, 'label');
				placeholder.setAttribute('value', 'No domains eligible for whitelist.');
				panelContent.appendChild(placeholder);
				return;
			}

			const contentDocument = page.contentWindow.document;
			const scripts = Array.from(contentDocument.getElementsByTagName('script'));
			const scriptUris = scripts
				.filter(script => script.src)
				.map(script => Services.io.newURI(script.src, null, null));
			const uris = [pageUri].concat(scriptUris);

			uniqueBy(
				uris
					.filter(whitelist.matchable)
					.map(hostOnlyFor),
				hostOnly => hostOnly.spec
			).forEach(addToggle);
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
		},
	};

	const contentPolicy = {
		classDescription: 'Descript script-blocking content policy',
		classID: Components.ID('336169ae-edc5-4a61-871a-16eeb9837bcf'),
		contractID: '@descript/policy;1',
		QueryInterface: XPCOMUtils.generateQI([
			nsIContentPolicy,
			nsIFactory,
		]),
		shouldLoad: function shouldLoad(type, uri) {
			if (type === nsIContentPolicy.TYPE_SCRIPT && !whitelist.allows(uri)) {
				return nsIContentPolicy.REJECT_SERVER;
			}

			return nsIContentPolicy.ACCEPT;
		},
		shouldProcess: function shouldProcess() {
			return nsIContentPolicy.ACCEPT;
		},
		createInstance: function createInstance(outer, iid) {
			if (outer) {
				throw Components.results.NS_ERROR_NO_AGGREGATION;
			}

			return this.QueryInterface(iid);
		},
	};

	function startup() {
		Services.prefs
			.getDefaultBranch('extensions.descript.')
			.setCharPref('whitelist', '');

		domainPolicy = Services.scriptSecurityManager.activateDomainPolicy();
		whitelist.loadPreference(extensionPreferences.getCharPref('whitelist'));

		scriptsInitiallyEnabled = scriptPreferences.getBoolPref('enabled');
		scriptPreferences.setBoolPref('enabled', false);

		componentRegistrar.registerFactory(
			contentPolicy.classID,
			contentPolicy.classDescription,
			contentPolicy.contractID,
			contentPolicy
		);

		categoryManager.addCategoryEntry(
			'content-policy',
			contentPolicy.contractID,
			contentPolicy.contractID,
			false,
			false
		);

		Services.ww.registerNotification(windowObserver);
		eachWindow(addButton);
	}

	function shutdown() {
		if (!domainPolicy) {
			return;
		}

		categoryManager.deleteCategoryEntry(
			'content-policy',
			contentPolicy.contractID,
			false
		);

		componentRegistrar.unregisterFactory(
			contentPolicy.classID,
			contentPolicy
		);

		scriptPreferences.setBoolPref('enabled', scriptsInitiallyEnabled);
		domainPolicy.deactivate();

		Services.ww.unregisterNotification(windowObserver);
		eachWindow(removeButton);
	}

	return { startup, shutdown };
})();

function install() {
}

function uninstall() {
}
