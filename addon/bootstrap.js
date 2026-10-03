/* Zotero 10 bootstrapped extension. No Node/npm runtime required. */
var chromeHandle;
var RuleOutline;

async function startup({rootURI}) {
  const manager = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup);
  chromeHandle = manager.registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [
    ['content', 'rule-outline', 'content/'],
    ['content', 'rule-outline-vendor', 'vendor/'],
  ]);
  const scope = {Zotero, Services, ChromeUtils, Cc, Ci, IOUtils, PathUtils, rootURI};
  Services.scriptloader.loadSubScriptWithOptions('chrome://rule-outline/content/main.js', {target: scope, ignoreCache: true});
  RuleOutline = scope.RuleOutline;
  for (const win of Zotero.getMainWindows()) RuleOutline.addWindow(win);
}

function onMainWindowLoad({window}) { RuleOutline?.addWindow(window); }
function onMainWindowUnload({window}) { RuleOutline?.removeWindow(window); }
function install() {}
function uninstall() {}
async function shutdown() {
  if (RuleOutline) await RuleOutline.shutdown();
  RuleOutline = null;
  chromeHandle?.destruct();
  chromeHandle = null;
}
