/* exported startup, shutdown, install, uninstall */
/* globals Services, XPCOMUtils */

'use strict';

Components.utils.import('resource://gre/modules/Services.jsm');
Components.utils.import('resource://gre/modules/XPCOMUtils.jsm');

const whitelist = (function () {
	const httpsHosts = new Set();
	const httpHosts = new Set();

	function matchable(uri) {
		return uri.schemeIs('https') || uri.schemeIs('http');
	}

	function allows(uri) {
		if (uri.schemeIs('https')) {
			return httpsHosts.has(uri.host);
		}

		if (uri.schemeIs('http')) {
			return httpHosts.has(uri.host);
		}

		return true;
	}

	function add(uri) {
		if (uri.schemeIs('https')) {
			httpsHosts.add(uri.host);
		} else if (uri.schemeIs('http')) {
			httpHosts.add(uri.host);
		}
	}

	function remove(uri) {
		if (uri.schemeIs('https')) {
			httpsHosts.delete(uri.host);
		} else if (uri.schemeIs('http')) {
			httpHosts.delete(uri.host);
		}
	}

	function loadPreference(preference) {
		const uris = preference.match(/\S+/g);

		httpsHosts.clear();
		httpHosts.clear();

		if (!uris) {
			return;
		}

		for (let uri of uris) {
			add(Services.io.newURI(uri, null, null));
		}
	}

	function getPreference() {
		const result = [];

		for (let host of httpsHosts) {
			result.push(`https://${host}/`);
		}

		for (let host of httpHosts) {
			result.push(`http://${host}/`);
		}

		return result.join(' ');
	}

	return { matchable, allows, add, remove, loadPreference, getPreference };
})();

const { startup, shutdown } = (function () {
	const XUL_NS =
		'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

	const { nsIContentPolicy, nsIFactory } = Components.interfaces;

	const componentRegistrar =
		Components.manager
			.QueryInterface(Components.interfaces.nsIComponentRegistrar);

	const categoryManager =
		Components.classes['@mozilla.org/categorymanager;1']
			.getService(Components.interfaces.nsICategoryManager);

	const preferences = Services.prefs.getBranch('extensions.descript.');

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
				preferences.setCharPref('whitelist', whitelist.getPreference());
			};
		}

		function updateActions() {
			const currentHosts = new Set();

			function addToggle(uri) {
				const mainButton = document.getElementById('descript-button');
				const isMenu = mainButton.getAttribute('cui-areatype') === 'menu-panel';

				if (!whitelist.matchable(uri)) {
					return;
				}

				const hostSpec = hostOnlyFor(uri).spec;

				if (currentHosts.has(hostSpec)) {
					return;
				}

				if (whitelist.allows(uri)) {
					let button = addActionButton(`Remove ${hostSpec}${isMenu ? '' : ' from whitelist'}`);
					button.classList.add('descript-whitelist-remove');
					button.addEventListener(
						'command',
						whitelistAction(whitelist.remove, uri)
					);
				} else {
					let button = addActionButton(`Add ${hostSpec}${isMenu ? '' : ' to whitelist'}`);
					button.classList.add('descript-whitelist-add');
					button.addEventListener(
						'command',
						whitelistAction(whitelist.add, uri)
					);
				}

				currentHosts.add(hostSpec);
			}

			const page = window.getBrowser().selectedBrowser;
			const pageUri = page.registeredOpenURI;
			let child;

			while ((child = panelContent.firstChild)) {
				panelContent.removeChild(child);
			}

			if (!pageUri || !whitelist.matchable(pageUri)) {
				const placeholder = document.createElementNS(XUL_NS, 'label');
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

	const contentPolicy = {
		classDescription: 'Descript script-blocking content policy',
		classID: Components.ID('336169ae-edc5-4a61-871a-16eeb9837bcf'),
		contractID: '@descript/policy;1',
		QueryInterface: XPCOMUtils.generateQI([
			nsIContentPolicy, nsIFactory
		]),
		shouldLoad:
			function shouldLoad(
				contentType, contentLocation, requestOrigin, context,
				mimeTypeGuess, extra, requestPrincipal
			) {
				if (contentType === nsIContentPolicy.TYPE_SCRIPT && !whitelist.allows(contentLocation)) {
					return nsIContentPolicy.REJECT_SERVER;
				}

				return nsIContentPolicy.ACCEPT;
			},
		shouldProcess:
			function shouldProcess(
				contentType, contentLocation, requestOrigin, context,
				mimeType, extra, requestPrincipal
			) {
				return nsIContentPolicy.ACCEPT;
			},
		createInstance: function createInstance(outer, iid) {
			if (outer) {
				throw Components.results.NS_ERROR_NO_AGGREGATION;
			}

			return this.QueryInterface(iid);
		}
	};

	function startup() {
		Services.prefs
			.getDefaultBranch('extensions.descript.')
			.setCharPref('whitelist', '');
		whitelist.loadPreference(preferences.getCharPref('whitelist'));

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
		categoryManager.deleteCategoryEntry(
			'content-policy',
			contentPolicy.contractID,
			false
		);

		componentRegistrar.unregisterFactory(
			contentPolicy.classID,
			contentPolicy
		);

		Services.ww.unregisterNotification(windowObserver);
		eachWindow(removeButton);
	}

	return { startup, shutdown };
})();

function install() {
}

function uninstall() {
}
